#!/usr/bin/env python3
"""Known-good sample tool: sums two integers; --selftest is deterministic and exits 0."""
import sys


def add(a: int, b: int) -> int:
    return a + b


def selftest() -> int:
    assert add(2, 2) == 4
    assert add(-1, 1) == 0
    assert add(0, 0) == 0
    print("good-tool selftest OK")
    return 0


def main() -> int:
    if "--selftest" in sys.argv[1:]:
        return selftest()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        print("usage: tool.py <int> <int>", file=sys.stderr)
        return 2
    print(add(int(args[0]), int(args[1])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
