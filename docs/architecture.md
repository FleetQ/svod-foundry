# Svod Foundry — Architecture

> Status: M1 scaffold. Expanded with concrete sequence diagrams and the synthesis prompt contract
> in M5. The decision record lives in [`adr/`](adr/) (ADR-0001 … ADR-0004).

## One paragraph

Svod Foundry is a thin MCP server that lets an agent synthesize, verify, run, and promote tools at
runtime. It is a **client of the Svod engine** (its store of record, over MCP) and an **orchestrator
of Docker** (its execution substrate). It owns synthesis and safe execution; Svod owns persistence,
lifecycle, audit, and recall. Tools are [Agent Skills](adr/0004-artifact-format-agent-skills.md)
(`SKILL.md` + one script).

## Components

| Component | Path | Responsibility |
| --- | --- | --- |
| MCP server | `src/index.ts`, `src/foundry/` | Exposes `synthesize`/`verify`/`run`/`promote` to agents. |
| Svod client | `src/svod/` | MCP client to Svod: `context_pack`/`search`/`read`/`write`/`promote`/`history`/`diff`, optimistic concurrency. |
| Sandbox executor | `src/sandbox/` | Ephemeral Docker containers; deny-by-default egress; resource limits; one verify/run path. |
| Shared types / config | `src/types.ts`, `src/config.ts` | The contract between the three subsystems; config + secret-ref resolution. |

## Boundaries (what the foundry is NOT)

- **Not** merged into or vendoring the Svod engine — it talks to it over the network only.
- **Not** coupled to FleetQ — FleetQ is at most a future client behind a human approval gate.
- **Not** a second persistence/audit/recall layer — those are Svod's.
- **Not** a host-execution path — all tool code runs in the sandbox.

## Data flow (synthesize → verify → promote → run)

1. **synthesize(spec)** — recall Svod (`context_pack`, `enumerate=true`, `type:tool`) to check for an
   existing active tool; if uncovered, generate `SKILL.md` + script, `write` a `provisional` draft to
   `messy/tools/<name>/`, return `{ name, revision }`.
2. **verify(name)** — `read` the tool from Svod, materialize it to a temp dir, run its `selftest` in
   the sandbox, return pass/fail + exit code + stderr.
3. **run(name, args)** — same as verify but the `entry` command + caller args, through the identical
   sandbox path.
4. **promote(name)** — only on a green verify: Svod `promote` `messy/tools/<name>/` →
   `vault/tools/<name>/`, set `status: active`.

## Configuration

See [`config.sample.json`](../config.sample.json). Fields:

- `svod.endpoint` / `svod.tokenRef` / `svod.tls` — the Svod MCP endpoint and the bearer-token
  reference (the token is the foundry's identity; never inline the secret).
- `docker.socketPath` (or `host`/`port`), `docker.baseImages.{python,node}`,
  `docker.egressProxyImage` — Docker orchestration settings.
- `limits.{memory,cpus,pidsLimit,timeoutMs}` — default sandbox resource bounds.

## Safety invariants

Restated from [ADR-0003](adr/0003-sandbox-executor.md) and [SECURITY.md](../SECURITY.md):

1. All tool code runs only in an ephemeral `--rm` container.
2. Tool dir read-only; tmpfs scratch; no writable host bind mount.
3. `--network none` by default; egress only via an allowlisting proxy for declared domains.
4. `--memory` / `--cpus` / `--pids-limit` / wall-clock timeout on every run.
5. `verify` and `run` share one execution path.
6. `promote` requires a green verify.
7. Secrets are Svod refs, never literals.
