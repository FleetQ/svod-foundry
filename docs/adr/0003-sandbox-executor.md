# ADR-0003: Sandbox executor — contained, deny-by-default execution of untrusted code

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Svod Foundry maintainers

## Context

The foundry executes **machine-generated, untrusted code** — both to `verify` a tool (run its
self-test) and to `run` it against real arguments. This is the load-bearing safety component. A
generated script may try to read host files, exfiltrate data, fork-bomb, or burn unbounded CPU.
The executor must contain all of that **by default**, while still letting a *declared*, legitimate
tool reach a *declared* set of network destinations.

## Decision

Every `verify` and every `run` executes inside an **ephemeral Docker container**, created fresh and
removed (`--rm`) on exit. The two share **one execution path** — `run` is `verify` with different
arguments and (optionally) a different command — so a tool cannot pass verify and then behave
differently under run.

### The container contract

| Control | Setting | Rationale |
| --- | --- | --- |
| Lifetime | One container per call, `AutoRemove: true` | No state survives between executions. |
| Base image | Fixed per runtime: `python:3.12-slim`, `node:22-slim` | Deterministic, known surface (v1; per-skill images are a future ADR). |
| Tool directory | Mounted **read-only** | Generated code cannot mutate its own artifact or escape via it. |
| Scratch space | **tmpfs** at a known working dir | Writable scratch with no host persistence; cleared with the container. |
| Host filesystem | **No** writable host bind mount | The host FS is not reachable. |
| Network (default) | `--network none` | Deny-by-default egress. A tool that declared no network has no network. |
| Network (allowlisted) | Routed through an **allowlisting egress proxy** | Only when the skill frontmatter `network` allowlist names domains; only those domains resolve/connect. |
| Memory | `--memory` (configurable cap) | Bounds memory. |
| CPU | `--cpus` / `NanoCpus` (configurable cap) | Bounds CPU. |
| Processes | `--pids-limit` (configurable cap) | Defeats fork bombs. |
| Wall clock | Host-side timeout that kills the container | Bounds runtime even if the in-container process ignores signals. |
| Privileges | Non-root where the base image allows; no `--privileged`; drop capabilities | Reduce escape surface. |

### The egress model

- The skill's frontmatter carries `network: []` (empty ⇒ no egress) or `network: ["api.example.com",
  …]`.
- Empty/absent ⇒ container gets `--network none`. There is no proxy, no resolver, nothing.
- Non-empty ⇒ the container is attached to an internal Docker network whose only outbound path is an
  **allowlisting forward proxy**. The proxy permits CONNECT/GET only to the declared domains and
  refuses everything else. The container's `HTTP(S)_PROXY` is pointed at it. This mirrors the
  "allowed domains" model: a destination not on the list is unreachable, not merely discouraged.

### One path, two entry points

```
executeInSandbox({ toolDir, runtime, command, args, network, limits, timeoutMs }) -> { exitCode, stdout, stderr, timedOut }

verify(name) = executeInSandbox(command = <self-test entry from SKILL.md>)
run(name, a) = executeInSandbox(command = <run entry from SKILL.md>, args = a)
```

Both go through the identical `executeInSandbox`. There is no second, "lighter" path.

## Alternatives considered

- **Run on the host with a restricted user.** Rejected: no real filesystem/network/resource
  isolation, and a single bug is a host RCE.
- **gVisor / Kata / Firecracker microVMs.** Stronger isolation, more operational weight. Deferred:
  v1 uses stock Docker with the controls above; the `executeInSandbox` seam lets us swap the runtime
  later without touching callers.
- **A long-lived warm container reused across runs.** Rejected: state bleed between tools breaks the
  "nothing survives" guarantee and complicates attribution.
- **An iptables/nftables egress filter instead of a proxy.** Workable but coarser (IP, not domain)
  and harder to audit; a domain-allowlisting proxy matches how skills declare egress.

## Consequences

- Docker (a reachable Engine API) is a hard runtime dependency.
- First execution of a runtime may pay an image-pull cost; images are pinned and cached.
- The egress proxy is itself a component to run and test; the integration suite includes a
  known-malicious sample that must be **contained/denied** (no host write, no undeclared egress, no
  resource exhaustion), alongside a known-good sample that must pass.
- Because verify and run share a path, the integration test for one largely covers the other.
