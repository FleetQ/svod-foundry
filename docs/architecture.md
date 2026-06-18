# Svod Foundry — Architecture

The decision record lives in [`adr/`](adr/) (ADR-0001 … ADR-0005); this document is the
implementation-level map.

## One paragraph

Svod Foundry is a thin MCP server that lets an agent synthesize, verify, run, and promote tools at
runtime. It is a **client of the Svod engine** (its store of record, over MCP) and an **orchestrator
of Docker** (its execution substrate). It owns synthesis and safe execution; Svod owns persistence,
lifecycle, audit, and recall. Tools are [Agent Skills](adr/0004-artifact-format-agent-skills.md)
(`SKILL.md` + one script). The calling agent generates the code; the foundry assembles the canonical
artifact and governs its lifecycle ([ADR-0005](adr/0005-synthesis-contract.md)).

## Components

| Component | Path | Responsibility |
| --- | --- | --- |
| MCP server | `src/index.ts`, `src/foundry/server.ts` | Exposes `synthesize`/`verify`/`run`/`promote` over streamable HTTP (default) or stdio. |
| Foundry orchestrator | `src/foundry/foundry.ts` | The loop logic; wires Svod + sandbox behind injectable interfaces. |
| Skill assembly | `src/foundry/skill.ts`, `src/foundry/spec.ts` | Builds/parses the Agent Skill artifact; validates specs and frontmatter at the boundary. |
| Svod client | `src/svod/` | MCP client to Svod: `context_pack`/`search`/`read`/`write`/`promote`/`history`/`diff`, optimistic concurrency. |
| Sandbox executor | `src/sandbox/` | Ephemeral Docker containers; deny-by-default egress; resource limits; one verify/run path. |
| Shared types / config | `src/types.ts`, `src/config.ts` | The contract between subsystems; config + secret-ref resolution. |

## Boundaries (what the foundry is NOT)

- **Not** merged into or vendoring the Svod engine — it talks to it over the network only.
- **Not** coupled to FleetQ — FleetQ is at most a future client behind a human approval gate.
- **Not** a second persistence/audit/recall layer — those are Svod's.
- **Not** a host-execution path — all tool code runs in the sandbox.
- **Not** an LLM — the calling agent generates code; the foundry governs it (ADR-0005).

## A tool's shape in Svod

```
messy/tools/<name>/SKILL.md   <- typed note (type: tool, status: provisional); recall surfaces this
messy/tools/<name>/<entry>    <- the single script (e.g. tool.py)
        │ promote (revision-checked move; status -> active), only on a green verify
        ▼
vault/tools/<name>/SKILL.md
vault/tools/<name>/<entry>
```

`SKILL.md` frontmatter is the contract (ADR-0004): `name`, `description`, `type: tool`, `status`,
`runtime`, `entry`, `selftest`, `network`, `tags`, `secrets`. The `selftest`/`entry` commands
reference the in-container tool mount (`/tool`) so they run identically under verify and run.

## The loop

### synthesize(spec)

1. Validate the spec (boundary). 2. **Recall** Svod (`recallTools` = `context_pack` enumerate +
`type:tool`); if an **active** tool of the same name exists, return it with `skipped: true` (don't
rebuild). 3. Assemble `SKILL.md` + script. 4. `write` both to `messy/tools/<name>/` (optimistic
concurrency; a re-synthesis over an existing draft updates with the current revision, never blind-
overwrites). 5. Return `{ name, revision, skipped: false }`.

### verify(name)

`read` the `SKILL.md` (→ runtime/entry/selftest/network), `read` the script, materialize both to a
host temp dir, and `executeInSandbox(selftest)`. Return `{ pass, exitCode, stdout, stderr, timedOut
}` where `pass = exitCode 0 && !timedOut`. The temp dir is removed afterward.

### run(name, args)

Same materialize, but the `entry` command + caller args, through the **identical** sandbox path.
Resolves the tool from `messy/` then `vault/`. Returns `{ exitCode, stdout, stderr, timedOut }`.

### promote(name)

Re-run `verify`. **Only on green**: flip the provisional `SKILL.md`'s frontmatter `status` to
`active` (an optimistic write — Svod's `promote` is a pure per-note move and does not rewrite
frontmatter), then `promote` both notes — `messy/tools/<name>/SKILL.md` and the script — to
`vault/tools/<name>/`, each revision-checked. On red, return `{ promoted: false, verify }` and do
nothing in Svod.

```
agent ──synthesize──▶ Svod write (messy, provisional)
      ──verify──────▶ sandbox self-test ──✗──▶ stays provisional
                                          └─✓
      ──run─────────▶ sandbox execution (contained)
      ──promote─────▶ verify(green) ──▶ Svod move messy→vault, status:active
                                   └─red──▶ refused
```

## Transports

The foundry MCP surface is exposed per `config.server.transport`:

- **`http`** (default) — streamable HTTP in **stateless** mode: a fresh `McpServer` + transport per
  request, sharing one `Foundry` (and its single Svod connection). Mounted at `config.server.path`
  (default `/mcp`) on `host:port` (default `0.0.0.0:7519`). Matches Svod's networked model and the
  `docker compose` service.
- **`stdio`** — one server bound to stdin/stdout, for an agent that spawns the foundry as a
  subprocess. Logs always go to stderr so they never corrupt the stdio stream.

The HTTP surface can synthesize/run/promote tools, so it is hardened: the default bind is **loopback**
(`127.0.0.1`); **DNS-rebinding protection** is enabled (only expected `Host`/`Origin` headers via
`server.allowedHosts`/`allowedOrigins` are accepted); and an optional **bearer token**
(`server.authTokenRef`) is enforced with a constant-time comparison on every request. A non-loopback
bind without an auth token logs a loud startup warning — set `authTokenRef` for any networked
exposure. Containerized runs bind `0.0.0.0` inside the container while the published port stays
host-loopback-only (see `docker-compose.yml`).

## Configuration

See [`config.sample.json`](../config.sample.json). Fields:

- `svod.endpoint` / `svod.tokenRef` / `svod.tls` — Svod MCP endpoint and the bearer-token reference
  (the token is the foundry's identity; never inline the secret).
- `docker.socketPath` (or `host`/`port`), `docker.baseImages.{python,node}`,
  `docker.egressProxyImage` — Docker orchestration settings.
- `limits.{memory,cpus,pidsLimit,timeoutMs}` — default sandbox resource bounds.
- `server.{transport,host,port,path}` — how the foundry exposes its own MCP surface.

Secret references resolve via `env:` / `file:` (`keychain:` is reserved for the host/Svod).

## Safety invariants

Restated from [ADR-0003](adr/0003-sandbox-executor.md) and [SECURITY.md](../SECURITY.md):

1. All tool code runs only in an ephemeral `--rm` container.
2. Tool dir read-only; tmpfs scratch; no writable host bind mount.
3. `--network none` by default; egress only via an allowlisting proxy for declared domains.
4. `--memory` / `--cpus` / `--pids-limit` / wall-clock timeout on every run.
5. `verify` and `run` share one execution path.
6. `promote` requires a green verify (structural — it re-verifies).
7. Secrets are Svod refs, never literals.

## Testing

- **Unit** (`npm test`, no Docker/network): config, Svod client (mocked MCP seam), sandbox spec
  builder, and the full foundry loop with a fake Svod + fake executor.
- **Integration** (`npm run test:integration`, gated by `RUN_INTEGRATION=1`): the sandbox containment
  suite (Docker-only — known-good passes, known-malicious contained), the Svod round-trip + conflict
  suite (needs a live Svod), and the foundry end-to-end loop (needs both). Each skips cleanly when its
  dependency is absent.
