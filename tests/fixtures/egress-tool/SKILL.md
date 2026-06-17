---
name: egress-tool
description: Egress-allowlist probe — fetches an allowlisted host and a non-allowlisted host.
type: tool
status: provisional
runtime: python
entry: tool.py
selftest: "python /tool/tool.py example.com example.org"
network: [example.com]
tags: [fixture, sandbox-integration, egress]
secrets: []
---

# egress-tool

Used by the sandbox integration suite to exercise the allowlisting egress proxy (ADR-0003). Given
two hostnames as args, it tries to HTTP-GET each through the proxy and prints a line per host:

```
ALLOWED <host> <status-or-ERR>
BLOCKED <host> <status-or-ERR>
```

With `network: [example.com]`, the first host must be reachable through the proxy and the second
(non-allowlisted) must be refused.
