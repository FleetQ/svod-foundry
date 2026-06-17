# Svod Foundry

**An auditable tool foundry for AI agents — capabilities you can read, `git diff`, and restore.**

Svod Foundry lets an AI agent **synthesize new tools at runtime** instead of being limited to a
fixed, predefined toolbox. When an agent hits a task no existing tool covers, it asks the foundry
to *make* one: the foundry generates an **Agent Skill** (a `SKILL.md` + one executable script),
runs it **only inside an ephemeral, contained sandbox**, and — once it passes its own self-test —
stores it in [Svod](https://github.com/FleetQ/svod-engine) as a **versioned, attributable,
auditable memory note**. The capability stops being throwaway codegen you have to trust and
becomes something you can open in any editor, search, `git diff`, blame, and roll back.

It is the same guarantee Svod gives *facts*, applied to *tools*: nothing is lost, everything is
attributable, and a bad tool is fixable. A synthesized tool is just a Svod typed-memory note
(`type: tool`) that moves through a lifecycle — `provisional` → `active` — gated on a green verify
in the sandbox.

> **Positioning:** Svod Foundry is **not** part of the Svod engine and **not** a standalone
> product brand. It is a thin, standalone **MCP server** that *depends on* a running Svod engine
> as its store of record and *orchestrates Docker* as its execution substrate. Svod owns
> persistence, lifecycle, audit, and recall; the foundry owns synthesis and safe execution.
> Tools are written in the **open [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
> standard** (`SKILL.md` + script) — no invented format, no lock-in.

**Jump to:**
[Why it exists](#why-svod-foundry-exists) ·
[What it does](#what-it-does) ·
[Architecture](#architecture) ·
[The agent interface (4 MCP tools)](#the-agent-interface--4-mcp-tools) ·
[The lifecycle of a synthesized tool](#the-lifecycle-of-a-synthesized-tool) ·
[Safety model](#safety-model) ·
[Configuration](#configuration) ·
[Quickstart](#quickstart) ·
[Status](#status)

---

## Why Svod Foundry exists

An agent's toolbox is normally fixed at design time. Anything the designer didn't foresee, the
agent simply cannot do — or it improvises with shell one-liners that are unaudited, unrepeatable,
and gone the moment the turn ends. The two common "solutions" are both bad:

1. **Let the agent run arbitrary code on the host.** Fast, and a remote-code-execution
   foothold by construction. No isolation, no provenance, no review, no undo.
2. **Hand-write every tool up front.** Safe, and a bottleneck — the agent can only ever do what
   a human already anticipated and shipped.

Svod Foundry takes the substrate that already won for durable, auditable agent *memory* — a git
repo behind a single safe writer (Svod) — and uses it as the store of record for agent
*capabilities*, behind a Docker sandbox that treats all generated code as untrusted:

- **Nothing reaches production untested.** No tool becomes `active`, and no provisional code ever
  runs outside the sandbox, without a passing self-test. `verify` and `run` share one execution
  path, so "it worked in verify" means it works in run.
- **Every tool is attributable.** A synthesized tool is a Svod commit, authored by the specific
  agent identity (the bearer token *is* the identity). "Which agent made this tool, and when?" is
  `git log`.
- **A bad tool is fixable.** Wrong or unsafe? `git revert`, restore a prior revision, or edit the
  `SKILL.md` by hand. The next recall sees the corrected state.
- **Recall is the registry.** "What tools do I already have?" is a single Svod `context_pack`
  call filtered to `type:tool` — the live, active tool registry, verbatim.

## What it does

- **Synthesize.** Given a spec, the foundry first *recalls* Svod to check whether an active tool
  already covers it (recall-first discipline — don't rebuild what exists). If not, it generates a
  `SKILL.md` + script, writes them as a `provisional` draft under `messy/tools/<name>/` in Svod,
  and returns the name + revision.
- **Verify.** Runs the tool's deterministic self-test inside an ephemeral Docker container and
  reports pass/fail + exit code + stderr. This is the gate everything else hangs on.
- **Run.** Executes a tool against real arguments — through the *identical* sandbox path used by
  verify — and returns stdout/stderr/exit.
- **Promote.** On a green verify only, performs Svod's revision-checked move from
  `messy/tools/<name>/` to `vault/tools/<name>/` and sets `status: active`. This is the
  draft→publish gate, reused from Svod rather than reinvented.

Listing/recall is **not** a foundry tool — it is just Svod `context_pack`/`search`. The foundry
does not duplicate persistence, lifecycle, audit, or recall; it leans entirely on Svod for them.

## Architecture

```
        ┌─────────────────────────────┐
        │        AI agent             │
        │  (Claude / Cursor / …)      │
        └──────────────┬──────────────┘
                       │ MCP (synthesize / verify / run / promote)
                       ▼
        ┌─────────────────────────────┐         MCP (context_pack / write /
        │       Svod Foundry          │────────▶ read / promote / history / diff)
        │      (this project)         │         ┌──────────────────────────────┐
        │                             │────────▶│   Svod engine (store of      │
        │  synthesize → write draft   │         │   record; git-backed memory) │
        │  verify/run → sandbox       │         └──────────────────────────────┘
        └──────────────┬──────────────┘
                       │ Docker API (ephemeral --rm containers)
                       ▼
        ┌─────────────────────────────┐
        │   Sandbox executor          │   tool dir read-only · tmpfs scratch ·
        │   (python:3.12-slim /       │   --network none by default · mem/cpu/pids
        │    node:22-slim)            │   limits · wall-clock timeout
        └─────────────────────────────┘
```

The foundry is a **client of Svod over the network** (MCP, streamable HTTP, `Authorization:
Bearer <token>`). It does **not** merge into, vendor, or modify the engine. It is also **not
coupled to FleetQ**; FleetQ is at most a future client behind a human approval gate, out of scope
here.

See [`docs/architecture.md`](docs/architecture.md) for the full design and
[`docs/adr/`](docs/adr/) (ADR-0001 through ADR-0005) for the decision record.

## The agent interface — 4 MCP tools

| Tool | Role | What it does |
| --- | --- | --- |
| `synthesize(spec)` | write | Recall-checks Svod; if uncovered, generates `SKILL.md` + script and writes a `provisional` draft under `messy/tools/<name>/`. Returns `{ name, revision }`. |
| `verify(name)` | write | Runs the tool's self-test in the sandbox. Returns `{ pass, exitCode, stdout, stderr }`. |
| `run(name, args)` | write | Executes the tool in the sandbox via the identical verify path. Returns `{ exitCode, stdout, stderr }`. |
| `promote(name)` | write | **Only on a green verify.** Svod-moves `messy/tools/<name>/` → `vault/tools/<name>/`, sets `status: active`. |

Recall/list is intentionally absent — use Svod's `context_pack` (with `enumerate=true` +
`type:tool` filter) or `search` directly.

## The lifecycle of a synthesized tool

```
spec ──synthesize──▶ messy/tools/<name>/   (status: provisional, in Svod, committed, attributed)
                          │
                          ├─verify──▶ sandbox self-test ──✗──▶ stays provisional (fix & re-synthesize)
                          │                              └─✓──┐
                          │                                   │
                          ├─run────▶ sandbox execution (allowed on a verified provisional tool)
                          │                                   │
                          └─promote (green verify required)───┘──▶ vault/tools/<name>/ (status: active)
                                                                        │
                                                                  recall via Svod context_pack(type:tool)
```

## Safety model

Generated code is **untrusted by default**. The load-bearing guarantees (ADR-0003):

- **Ephemeral containers.** Each verify/run is a fresh container, `--rm` on exit. No state
  survives between runs.
- **No host filesystem.** The tool directory is mounted **read-only**; scratch space is a
  **tmpfs**; there is **no** host bind mount.
- **Deny-by-default egress.** Containers run `--network none` unless the skill frontmatter's
  `network` allowlist declares domains — in which case traffic is forced through an allowlisting
  egress proxy. A tool cannot reach the network it didn't declare.
- **Resource bounds.** `--memory`, `--cpus`, `--pids-limit`, and a wall-clock timeout cap every
  execution.
- **One execution path.** `verify` and `run` use the identical code path, killing
  "works-in-verify, breaks-in-run" drift.
- **Secrets are references, never literals.** Skills name secrets only as Svod secret refs
  (`env:` / `file:` / `keychain:`); Svod's pre-commit secret scanning is the backstop.

## Configuration

Copy [`config.sample.json`](config.sample.json) to `config.json` and edit it. Key fields: the
Svod MCP endpoint + bearer token reference, Docker settings, the per-runtime base images, and the
default resource limits. See [Configuration in the architecture doc](docs/architecture.md#configuration).

## Quickstart

> **Prerequisites:** Docker, Node.js ≥ 22, and a reachable Svod engine
> (default `http://127.0.0.1:7518/mcp`) with a WRITE-role bearer token.

```bash
npm install
cp config.sample.json config.json   # then edit: Svod endpoint + token ref
npm run build

# Run everything end-to-end (foundry + a Svod engine) for integration testing:
docker compose up -d
npm run test:integration

# Or run the foundry MCP server directly:
npm start
```

Point your agent's MCP client at the foundry, and load [`skill/SKILL.md`](skill/SKILL.md) so the
agent knows *when* and *how* to use it (recall-first, verify-before-promote, never run unverified
code outside the sandbox). An end-to-end worked example lives in [`examples/`](examples/).

## Status

**v0.1.0 — alpha, feature-complete for v1.** Repo skeleton + decision record (ADR-0001 scope & Svod
dependency, ADR-0002 stack, ADR-0003 sandbox/executor, ADR-0004 artifact format, ADR-0005 synthesis
contract) → Svod MCP client wrapper (auth, `context_pack`/`write`/`read`/`promote`, optimistic
concurrency) → Docker sandbox executor (deny-by-default egress, resource limits, identical verify/run
path; contained against a known-malicious sample) → foundry MCP server (`synthesize`/`verify`/`run`/
`promote`, streamable HTTP + stdio) → the foundry Skill + worked example (`examples/`) + architecture
doc.

Full unit suite green (config, Svod client, sandbox spec, end-to-end foundry loop) and CI-gated on
every change; the sandbox containment suite runs on Docker in CI, and the Svod/foundry integration
suites run against a live Svod engine via `docker compose`. Each integration suite skips cleanly when
its dependency is absent. See [`docs/adr/`](docs/adr/) for the decision record and
[`CONTRIBUTING.md`](CONTRIBUTING.md) for how changes are gated.

This is **v1 scope: MCP-only to agents.** No App API/UI surface, no FleetQ coupling, no
signal/webhook → synthesize wiring, no per-skill base images, no encryption at rest — see
[ADR-0001](docs/adr/0001-scope-and-svod-dependency.md) for what is deliberately out of scope.

## License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE). Copyright 2026 FleetQ.
