# Security Policy

Svod Foundry exists to run **untrusted, machine-generated code**. Security is not a feature here —
it is the entire point. This document describes the threat model, the guarantees the project makes,
and how to report a vulnerability.

## Threat model

The central assumption: **all synthesized tool code is hostile until proven otherwise.** A
synthesized `SKILL.md` + script may have been generated from a poisoned spec, a prompt-injection
payload, or simply a buggy model. The foundry must contain it regardless.

Specifically in scope:

- A generated script that tries to read or write the host filesystem.
- A generated script that tries to exfiltrate data over the network.
- A generated script that tries to consume unbounded CPU, memory, processes, or wall-clock time.
- A generated script that tries to escalate out of its container.
- A generated `SKILL.md` that declares secrets inline rather than as references.
- A stale or racing write to the Svod store of record.

Out of scope for v1 (documented, not silently ignored — see
[ADR-0001](docs/adr/0001-scope-and-svod-dependency.md)):

- Encryption at rest of the Svod store (delegated to Svod / the host).
- Kernel-level container escapes via 0-day in the Docker runtime (mitigated by limits and
  no-network defaults, but not independently sandboxed with gVisor/Kata in v1).
- FleetQ-side approval gating (the foundry is not coupled to FleetQ).

## Guarantees

1. **No code runs outside the sandbox.** `verify` and `run` both execute exclusively inside an
   ephemeral Docker container (`--rm`). There is no host-execution path.
2. **No host filesystem exposure.** The tool directory is mounted **read-only**; scratch is a
   **tmpfs**; there is **no** host bind mount of any writable host path.
3. **Deny-by-default egress.** Containers run `--network none` unless the skill's frontmatter
   `network` allowlist names domains, in which case egress is forced through an allowlisting proxy.
   An undeclared destination is unreachable.
4. **Bounded resources.** Every execution is capped by `--memory`, `--cpus`, `--pids-limit`, and a
   wall-clock timeout.
5. **Identical verify/run path.** A tool cannot behave differently under `run` than it did under
   `verify`, because the execution code path is the same.
6. **Promotion requires a green verify.** Nothing reaches `status: active` without a passing
   self-test.
7. **Secrets are references only.** Skills name secrets as Svod secret refs (`env:` / `file:` /
   `keychain:`), never inline. Svod's pre-commit secret scanning is the backstop.
8. **Optimistic concurrency.** Writes to Svod carry `expectedRevision`; a stale write is rejected
   with a structured `conflict` and re-read/merged/retried — never blind-overwritten.
9. **Hardened HTTP surface.** The foundry's own MCP endpoint can synthesize/run/promote tools, so it
   defaults to a **loopback** bind, enables **DNS-rebinding protection** (`Host`/`Origin` allowlist),
   and enforces an optional **bearer token** (`server.authTokenRef`) with a constant-time comparison.
   A non-loopback bind without a token warns loudly at startup. Use a token for any networked
   exposure.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.

- Email the maintainers (see repository metadata) with a clear description, reproduction steps, and
  the impact you observed.
- Allow reasonable time for a fix before any public disclosure.
- A finding that demonstrates a sandbox escape, an egress bypass, a host filesystem write, or a way
  to promote unverified code is considered **critical**.

If you are testing the sandbox yourself, the integration suite ships a deliberately
known-malicious sample script; the test asserts that it is contained/denied. Extending that suite
with new escape attempts is a welcome contribution.
