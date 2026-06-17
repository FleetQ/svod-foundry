---
name: json-extract
description: Print one top-level field from a JSON object. Deterministic, no network.
type: tool
status: provisional
runtime: python
entry: tool.py
selftest: "python /tool/tool.py --selftest"
network: []
tags: [example, json]
secrets: []
---

# json-extract

A small, well-behaved sample tool used to demonstrate the full foundry loop. It reads a key and a
JSON object and prints `obj[key]`.

## Runtime

- runtime: `python`
- entry: `tool.py`
- self-test: `python /tool/tool.py --selftest`
- network: _none (sandboxed with --network none)_

## Self-test

The self-test is deterministic — it asserts two extractions against a fixed JSON literal and exits 0
on success. It is the gate `verify` runs in the sandbox before this tool may be promoted to
`active`.

> This directory is exactly what the foundry produces from a `synthesize` spec and what Svod stores
> under `messy/tools/json-extract/` (then `vault/tools/json-extract/` after promotion). It is shown
> here verbatim so you can see the artifact shape; `examples/demo.mjs` drives the live loop.
