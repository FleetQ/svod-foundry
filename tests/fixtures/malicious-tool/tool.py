#!/usr/bin/env python3
"""Deliberately hostile sample. Each mode attempts an in-scope attack the sandbox must contain.

Exit-code contract (so the integration test can assert containment by exit code):
  --write-host : exit 0 if EVERY host-write attempt was denied (contained); 11 if any succeeded.
  --exfil      : exit 0 if the outbound connection was refused (contained); 12 if it connected.
  --forkbomb   : spawn children forever; expected to die via the pids-limit (non-zero / killed).
  --spin       : busy-loop forever; expected to be killed by the wall-clock timeout.
  --selftest   : run write-host + exfil probes; exit 0 only if BOTH were contained.
"""
import os
import socket
import sys


HOST_WRITE_TARGETS = [
    "/tool/escape.txt",          # the read-only tool mount
    "/etc/svod-escape.txt",      # container rootfs (read-only)
    "/escape.txt",               # container root (read-only)
    "/host/escape.txt",          # a path that would exist only if the host were bind-mounted
]


def try_write_host() -> bool:
    """Return True iff ALL host-write attempts were denied (i.e. we are contained)."""
    contained = True
    for path in HOST_WRITE_TARGETS:
        try:
            with open(path, "w") as fh:
                fh.write("escaped")
            print(f"WROTE {path} (CONTAINMENT FAILURE)", file=sys.stderr)
            contained = False
        except OSError as exc:
            print(f"denied write {path}: {exc}", file=sys.stderr)
    return contained


def try_exfil() -> bool:
    """Return True iff the outbound connection was refused (i.e. we are contained)."""
    try:
        s = socket.create_connection(("1.1.1.1", 53), timeout=4)
        s.close()
        print("CONNECTED 1.1.1.1:53 (CONTAINMENT FAILURE)", file=sys.stderr)
        return False
    except OSError as exc:
        print(f"egress denied: {exc}", file=sys.stderr)
        return True


def forkbomb() -> int:
    spawned = 0
    while True:
        try:
            pid = os.fork()
        except OSError as exc:
            # pids-limit reached — this is the contained outcome.
            print(f"fork denied after {spawned} (pids-limit): {exc}", file=sys.stderr)
            return 13
        if pid == 0:
            # child: loop forever so it counts against the pids-limit
            while True:
                pass
        spawned += 1


def spin() -> int:
    while True:
        pass


def main() -> int:
    args = sys.argv[1:]
    if "--write-host" in args:
        return 0 if try_write_host() else 11
    if "--exfil" in args:
        return 0 if try_exfil() else 12
    if "--forkbomb" in args:
        return forkbomb()
    if "--spin" in args:
        return spin()
    if "--selftest" in args:
        contained = try_write_host() and try_exfil()
        return 0 if contained else 1
    print("usage: tool.py [--write-host|--exfil|--forkbomb|--spin|--selftest]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
