---
name: svod-foundry
description: >-
  Synthesize, verify, run, and promote new tools at runtime when no existing tool covers a task.
  Use when you need a capability you don't have: have the foundry make an Agent Skill, prove it in
  the sandbox, and store it in Svod as a versioned, attributable tool. Recall first, verify before
  promote, and never run unverified generated code outside the sandbox.
---

# Svod Foundry — synthesizing tools at runtime

You have access to a **tool foundry**. When you hit a task that no existing tool covers, you do not
have to improvise with throwaway shell commands — you can have a **new tool made**, proven safe, and
saved durably. A synthesized tool is an Agent Skill (a `SKILL.md` + one script). It runs **only**
inside a sandbox, and it is stored in [Svod](https://github.com/FleetQ/svod-engine) as a versioned,
attributable memory note (`type: tool`) that moves `provisional → active`.

## When to use this

- You need an operation you have no tool for (parse this format, call this API, transform this data),
  and it's reusable enough to be worth keeping.
- You want the capability to be auditable and durable — readable, diffable, restorable — not a
  one-off you'll regenerate next time.

**Do not** use it for a one-shot computation you can do inline, or when an active tool already exists
(check first — see below).

## The discipline (non-negotiable)

### 1. Recall first

Before synthesizing, check whether an **active** tool already does the job. Recall is **not** a
foundry tool — query **Svod** directly:

- `context_pack` with `enumerate: true` and a `type: tool` filter → the full active tool registry,
  verbatim and unranked. Read it before you build.
- Or `search` for a ranked, query-driven look.

If a suitable active tool exists, **use it** (via `run`) instead of synthesizing a duplicate.
`synthesize` itself also recall-checks and will return `skipped: true` if an active tool of the same
name already exists.

### 2. Verify before you trust

A freshly synthesized tool is `provisional` — unproven. Call `verify(name)` and read the result.
A green verify (`pass: true`, exit 0) means its self-test ran cleanly **in the sandbox**. A red
verify means the tool is broken: fix the spec and re-synthesize. Do not use a tool that hasn't
verified green.

### 3. Never run unverified code outside the sandbox

`run(name, args)` and `verify(name)` execute **inside the foundry's sandbox** — ephemeral container,
read-only tool mount, deny-by-default network, resource limits. That is the *only* execution path.
**Never** copy a synthesized script out and run it yourself, paste it into another shell, or execute
generated code on the host. If you need its output, get it from `run`.

### 4. Promote only on green

`promote(name)` publishes a tool (`messy/ → vault/`, `status: active`) and is allowed **only after a
passing verify** — it re-verifies internally and refuses on red. Promotion is the draft→publish
gate. Synthesize → verify → (run) → promote, in that order.

## The four tools

| Call | What it does |
| --- | --- |
| `synthesize(spec)` | Recall-checks Svod; if uncovered, assembles a `SKILL.md` + script and writes a `provisional` draft under `messy/tools/<name>/`. Returns `{ name, revision, skipped }`. |
| `verify(name)` | Runs the tool's self-test in the sandbox. Returns `{ pass, exitCode, stdout, stderr, timedOut }`. |
| `run(name, args)` | Executes the tool in the sandbox. Returns `{ exitCode, stdout, stderr, timedOut }`. |
| `promote(name)` | On a green verify only, publishes the tool as `active`. Returns `{ promoted, verify, path?, revision?, status? }`. |

## Writing a good `spec`

You are the code generator; the foundry assembles and governs. A spec needs:

- `name` — kebab-case, matches the tool's identity (e.g. `csv-stats`).
- `description` — one line: *when* to use this tool (this is what future-you recalls).
- `runtime` — `python` or `node` (selects the sandbox base image).
- `script` — the full source of the single executable. Make it **self-contained**.
- a **deterministic self-test** — by default the foundry wires `python /tool/<entry> --selftest`
  (or `node …`), so make your script support `--selftest` and exit 0 on success with no external
  state. This is the gate; a tool with a weak or non-deterministic self-test is worthless.
- `network` — leave empty for `--network none` (the default and safest). Only list domains the tool
  genuinely must reach; egress is then forced through an allowlisting proxy, and nothing else is
  reachable.
- `secrets` — **references only** (`env:NAME`, `file:/path`, `keychain:NAME`). Never put a literal
  secret in a spec or script.
- `tags` — for later recall.

## Secrets

A tool must name secrets only as Svod secret refs (`env:` / `file:` / `keychain:`), never as literal
values. If a task seems to require an inline secret, stop and reformulate it with a ref — Svod's
pre-commit secret scanning will reject literals anyway.

## A typical flow

1. **Recall** Svod (`context_pack`, `type: tool`). Found an active tool? Use `run`. Done.
2. **Synthesize** a spec with a deterministic `--selftest`. Note the returned `name`.
3. **Verify**. Red? Re-synthesize with the fix. Green? Continue.
4. **Run** it against your real input if you need the result now.
5. **Promote** so it's in the active registry for next time.

Everything the tool becomes is a normal Svod note afterward: `read` it, `history` it, `diff` it, or
restore a prior revision. That's the point — capabilities you can audit, not trust blindly.
