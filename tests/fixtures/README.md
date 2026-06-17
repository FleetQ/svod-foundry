# Test fixtures

Sample Agent Skills and scripts used by integration tests.

M3 sandbox executor fixtures:

- `good-tool/` — known-good sample. `python tool.py --selftest` is deterministic and exits 0; the
  green path the sandbox must allow.
- `malicious-tool/` — deliberately hostile sample. Its modes (`--write-host`, `--exfil`,
  `--forkbomb`, `--spin`) attempt the in-scope attacks from SECURITY.md; the sandbox must contain
  every one (read-only host FS, NetworkMode none, pids-limit, wall-clock timeout).
- `egress-tool/` — egress-allowlist probe (`network: [example.com]`). Reaches an allowlisted host
  through the proxy and is refused for a non-allowlisted host. The egress integration test that
  uses it needs the `node:22-slim` proxy image present (and outbound internet for the "reachable"
  half); it self-skips when the proxy image is unavailable.
