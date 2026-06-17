---
name: good-tool
description: A deterministic known-good sample tool — sums two integers and self-tests.
type: tool
status: provisional
runtime: python
entry: tool.py
selftest: "python /tool/tool.py --selftest"
network: []
tags: [fixture, sandbox-integration]
secrets: []
---

# good-tool

A trivial, well-behaved sample used by the sandbox integration suite. It reads two integers and
prints their sum. Its `--selftest` is deterministic (given no external state it always returns the
same pass/fail) and exits 0 on success — the green path the sandbox must allow.
