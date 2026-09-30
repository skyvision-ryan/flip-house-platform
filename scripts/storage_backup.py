#!/usr/bin/env python3
"""Snapshot SQLite and uploads while application writes are paused.

Uses SQLite's online backup API (including committed WAL data). Never copies
just the live database file. A same-disk copy is not an off-site backup.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
from uuid import uuid4


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def upload_hashes(uploads):
    if uploads.is_symlink() or not uploads.is_dir():
        raise ValueError("Missing uploads or symlinked uploads")
    result = {}
    for path in sorted(uploads.rglob("*")):
        if path.is_symlink():
            raise ValueError("Symlinked upload requires manual review")
        if path.is_file():
            result[path.relative_to(uploads).as_posix()] = digest(path)
    return result


def backup(data_dir, destination):
    data, destination = Path(data_dir).resolve(), Path(destination).resolve()
    database, uploads = data / "app.db", data / "uploads"
    if not database.is_file() or database.is_symlink() or destination.is_relative_to(uploads):
        raise ValueError("Invalid database or backup destination")
    before = upload_hashes(uploads)
    bundle = destination / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8])
    bundle.mkdir(parents=True, mode=0o700)
    (bundle / "INCOMPLETE").write_text("Do not restore until manifest.json has been verified.\n")
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as source:
        target_path = bundle / "app.db"
        target_path.touch(mode=0o600)
        with closing(sqlite3.connect(target_path)) as target:
            source.backup(target)
            if target.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise ValueError("SQLite integrity check failed")
            if target.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("SQLite foreign key check failed")
            tables = [row[0] for row in target.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            counts = {name: target.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in tables}
    shutil.copytree(uploads, bundle / "uploads")
    if before != upload_hashes(uploads) or before != upload_hashes(bundle / "uploads"):
        raise ValueError("Uploads changed during backup; pause writes and retry")
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "data_dir": str(data),
                "database_sha256": digest(bundle / "app.db"), "table_counts": counts, "uploads": before,
                "sqlite_integrity_verified": True, "restore_rehearsal_verified": False,
                "requires_writes_paused": True, "environment_secrets_included": False}
    (bundle / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    for path in bundle.rglob("*"):
        path.chmod(0o700 if path.is_dir() else 0o600)
    (bundle / "INCOMPLETE").unlink()
    return bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument("--writes-paused", action="store_true", required=True,
                        help="Confirm all application writes are paused without resetting the service")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        bundle = backup(args.data_dir, args.destination)
    except Exception:
        print("Backup failed; any INCOMPLETE bundle must not be used for restore.")
        return 1
    print(bundle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
