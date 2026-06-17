#!/usr/bin/env python3
"""json-extract — print one top-level field from a JSON object.

A deterministic, network-free sample tool used to demonstrate the full foundry loop
(synthesize -> verify -> run -> promote). Its --selftest is self-contained.

Usage:
    python tool.py <key> <json>      # print obj[key]
    python tool.py --selftest        # deterministic self-test (exit 0 on success)
"""
import json
import sys


def extract(key, blob):
    return json.loads(blob)[key]


def main(argv):
    if "--selftest" in argv:
        assert extract("name", '{"name": "svod", "n": 2}') == "svod"
        assert extract("n", '{"name": "svod", "n": 2}') == 2
        print("json-extract selftest OK")
        return 0
    if len(argv) < 3:
        print("usage: tool.py <key> <json>", file=sys.stderr)
        return 2
    key, blob = argv[1], argv[2]
    print(extract(key, blob))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
