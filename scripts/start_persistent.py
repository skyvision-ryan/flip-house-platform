#!/usr/bin/env python3
"""Render startup for an already restored SQLite database on a mounted disk.

Never provisions accounts or demo data. A missing disk/database stops startup
before importing the application; it must not silently create an empty site.
"""
from __future__ import annotations

import os
from contextlib import closing
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]


def configuration(env):
    for key in ("DEMO_MODE", "SEED_DEMO"):
        if env.get(key) != "0":
            raise ValueError(f"{key} must be 0")
    if env.get("TEAM_DEMO_RESET_ID", "").strip():
        raise ValueError("Remove TEAM_DEMO_RESET_ID before persistent startup")
    if len(env.get("SECRET_KEY", "").strip()) < 32:
        raise ValueError("A stable SECRET_KEY of at least 32 characters is required")
    if env.get("COOKIE_SECURE") != "1" or env.get("STORAGE", "local") != "local":
        raise ValueError("Require COOKIE_SECURE=1 and local storage")
    raw_mount, raw_data = env.get("PERSISTENT_DISK_PATH", ""), env.get("DATA_DIR", "")
    if not raw_mount or not raw_data or not Path(raw_mount).is_absolute() or not Path(raw_data).is_absolute():
        raise ValueError("Explicit absolute disk and data paths are required")
    mount, data = Path(raw_mount).resolve(), Path(raw_data).resolve()
    if mount == Path("/") or not os.path.ismount(mount) or not data.is_relative_to(mount):
        raise ValueError("Data must be inside an actually mounted persistent disk")
    database = data / "app.db"
    if env.get("DB_URL") not in (None, "", f"sqlite:///{database}"):
        raise ValueError("DB_URL must point to DATA_DIR/app.db")
    if not database.is_file() or database.is_symlink() or not (data / "uploads").is_dir():
        raise ValueError("Restore the original database and uploads before startup")
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise ValueError("Database integrity check failed")
        if not db.execute("SELECT count(*) FROM users").fetchone()[0]:
            raise ValueError("Existing accounts are required; never initialize replacement accounts")
        if not db.execute("SELECT count(*) FROM projects").fetchone()[0]:
            raise ValueError("Existing projects are required; verify the restore")
        # Existing absolute attachment paths must resolve on the new mount too.
        for table in ("files", "procurement_images"):
            for (stored_path,) in db.execute(f"SELECT stored_path FROM {table}"):
                path = Path(stored_path).resolve()
                if not path.is_relative_to((data / "uploads").resolve()) or not path.is_file():
                    raise ValueError("An attachment is missing or outside persistent uploads")
    port = int(env.get("PORT", "10000"))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid PORT")
    return {"data": data, "port": port}


def main():
    try:
        config = configuration(os.environ)
        from storage_backup import backup
        # Render disk services run a single instance. The old instance stops
        # before this startup, so no application writer should be active yet.
        backup(config["data"], config["data"] / "startup-backups")
    except Exception:
        # Database/driver exceptions can contain private values. Do not log them.
        print("Persistent startup blocked: verify mount, original database, uploads, secret and demo flags. "
              "No demo reset or account provisioning was performed.", file=sys.stderr)
        return 1
    os.execv(sys.executable, [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", str(ROOT / "backend"),
                             "--host", "0.0.0.0", "--port", str(config["port"])])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
