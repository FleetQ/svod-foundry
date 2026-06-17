# Examples — the full foundry loop

This directory demonstrates the complete `synthesize → verify → run → promote` loop with one sample
synthesized tool, [`json-extract`](json-extract/) (a deterministic, network-free Agent Skill that
prints a field from a JSON object).

## What's here

- **[`json-extract/`](json-extract/)** — the synthesized tool **artifact**: a `SKILL.md` + a single
  `tool.py`. This is exactly the shape the foundry produces from a `synthesize` spec and that Svod
  stores under `messy/tools/json-extract/`, then `vault/tools/json-extract/` after promotion. It is
  checked in verbatim so you can see the format (ADR-0004).
- **[`demo.mjs`](demo.mjs)** — drives the **live** loop against a running stack.

## Run the live demo

> **Prerequisites:** Docker, Node ≥ 22, and a reachable Svod engine with a WRITE-role token.

```bash
npm run build
cp config.sample.json config.json      # edit: Svod endpoint + token ref
docker compose up -d                   # a live Svod engine
node examples/demo.mjs
```

You'll see four steps print in order:

1. **synthesize** — `{ name, revision, skipped }`. The foundry recall-checks Svod, assembles the
   Agent Skill, and writes a `provisional` draft. No code has executed yet.
2. **verify** — `{ pass: true, exitCode: 0, stdout: "json-extract selftest OK", … }`. The self-test
   ran **inside the sandbox** (`--network none`, read-only tool mount, resource-limited).
3. **run** — `{ exitCode: 0, stdout: "svod", … }`. The tool executed against real arguments through
   the *identical* sandbox path.
4. **promote** — `{ promoted: true, status: "active", path: "vault/tools/json-extract/" }`. Only
   because verify was green. The tool is now in the active registry.

## What it shows

- **Recall-first:** re-running the demo a second time returns `skipped: true` from `synthesize` — the
  active tool already covers it, so the foundry does not rebuild it.
- **Verify-before-promote:** if you break `tool.py`'s self-test, `verify` goes red and `promote`
  refuses to publish.
- **Sandbox-only execution:** both `verify` and `run` execute in an ephemeral container; nothing runs
  on the host.
- **Auditable in Svod:** after the demo, the tool is a normal Svod note — `read` it, `history` it,
  `diff` it, or restore a prior revision.
