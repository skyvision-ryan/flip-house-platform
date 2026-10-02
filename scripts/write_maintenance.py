#!/usr/bin/env python3
"""Enter only after all writers use WriteBarrier; a marker alone cannot protect old apps."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import time


def enter(data_dir: Path, timeout=60):
    marker = data_dir / "WRITE_MAINTENANCE"
    marker.touch(mode=0o600, exist_ok=True)
    with (data_dir / "write-barrier.lock").open("a") as lock:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return {"writes_blocked": True, "in_flight_writes_drained": True}
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Drain timed out; maintenance stays enabled")
                time.sleep(0.02)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=("enter", "status", "leave"))
    p.add_argument("--data-dir", type=Path, default=Path(os.environ.get("DATA_DIR", "backend/data")))
    args = p.parse_args()
    marker = args.data_dir / "WRITE_MAINTENANCE"
    if args.action == "enter":
        result = enter(args.data_dir)
    elif args.action == "leave":
        marker.unlink(missing_ok=True)
        result = {"writes_blocked": False}
    else:
        result = {"writes_blocked": marker.exists()}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
