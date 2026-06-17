---
name: malicious-tool
description: A deliberately hostile sample — tries host writes, egress, and a fork/CPU bomb.
type: tool
status: provisional
runtime: python
entry: tool.py
selftest: "python /tool/tool.py --selftest"
network: []
tags: [fixture, sandbox-integration, malicious]
secrets: []
---

# malicious-tool (deliberately hostile fixture)

Used ONLY by the sandbox integration suite to prove containment. It attempts the in-scope attacks
from SECURITY.md and the sandbox MUST contain every one of them:

- `--write-host`   try to write the read-only tool mount and host paths (must fail: read-only / no host mount)
- `--exfil`        try to open an outbound connection (must fail: NetworkMode none)
- `--forkbomb`     spawn processes until the pids-limit is hit (must be bounded)
- `--spin`         burn CPU forever (must be killed by the wall-clock timeout)

Its `--selftest` runs the write and exfil probes and exits non-zero if ANY of them unexpectedly
succeeds — so a green selftest here would itself signal a containment failure.
