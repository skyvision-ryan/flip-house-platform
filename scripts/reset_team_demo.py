"""Explicit, once-per-ID reset for a private single-house demo deployment."""
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3


def reset_once(config, generate, password):
    """Keep every user identity; restore the original database/files on failure."""
    from app import models
    from app.auth import hash_password
    from app.db import engine, init_db
    from prepare_team_demo import backup_and_verify

    data_dir, database = config["data_dir"], config["database"]
    uploads = data_dir / "uploads"
    if database.is_symlink() or uploads.is_symlink():
        raise ValueError("重置仅允许配置目录内的数据库和附件，不接受符号链接")
    state_dir = data_dir / "team-demo-resets"
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker = state_dir / (hashlib.sha256(config["reset_id"].encode()).hexdigest() + ".json")
    with (state_dir / "reset.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if marker.exists():
            return generate()
        init_db()
        engine.dispose()
        backup = backup_and_verify(database, uploads, data_dir / "team-demo-backups")
        try:
            with sqlite3.connect(database) as connection:
                connection.execute("PRAGMA foreign_keys=ON")
                users_before = connection.execute("SELECT * FROM users ORDER BY id").fetchall()
                for table in reversed(models.Base.metadata.sorted_tables):
                    if table.name != "users":
                        connection.execute(f'DELETE FROM "{table.name}"')
            if uploads.exists():
                shutil.rmtree(uploads)
            uploads.mkdir(parents=True)
            generate()
            engine.dispose()
            with sqlite3.connect(database) as connection:
                if connection.execute("SELECT count(*) FROM projects").fetchone()[0] != 1:
                    raise ValueError("重置后必须恰好保留一套演示房")
                users_after = {row[0]: row for row in connection.execute("SELECT * FROM users ORDER BY id")}
                if any(users_after.get(row[0]) != row for row in users_before):
                    raise ValueError("重置不得修改或删除已有账号资料")
                for user_id in users_after:
                    connection.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(password), user_id))
                if connection.execute("PRAGMA foreign_key_check").fetchall():
                    raise ValueError("重置后存在无效业务引用")
            # Marker is written only after the house and all account passwords commit.
            temporary = marker.with_suffix(".tmp")
            temporary.write_text(json.dumps({"reset_id": config["reset_id"], "backup": str(backup),
                "users_retained": len(users_before), "projects": 1}), encoding="utf-8")
            temporary.chmod(0o600)
            temporary.replace(marker)
            return "reset"
        except Exception:
            engine.dispose()
            # The server has not started; no other connection may write this DB.
            for suffix in ("-wal", "-shm"):
                Path(str(database) + suffix).unlink(missing_ok=True)
            shutil.copy2(backup / "database.sqlite3", database)
            if uploads.exists():
                shutil.rmtree(uploads)
            shutil.copytree(backup / "uploads", uploads)
            raise
