#!/usr/bin/env python3
"""Egress-allowlist probe: GET arg[0] (expected allowed) and arg[1] (expected blocked) via proxy.

Prints, one per line:
  ALLOWED <host> <status|ERR:Type>
  BLOCKED <host> <status|ERR:Type>

The HTTP(S)_PROXY env is injected by the sandbox; urllib honors it automatically.
"""
import sys
import urllib.request


def fetch(host: str) -> str:
    try:
        with urllib.request.urlopen(f"http://{host}/", timeout=8) as resp:
            return str(resp.status)
    except Exception as exc:  # noqa: BLE001 - we want the type name for any failure
        return "ERR:" + type(exc).__name__


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        print("usage: tool.py <allowed-host> <blocked-host>", file=sys.stderr)
        return 2
    print(f"ALLOWED {args[0]} {fetch(args[0])}")
    print(f"BLOCKED {args[1]} {fetch(args[1])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
