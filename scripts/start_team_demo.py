#!/usr/bin/env python3
"""Optional team-demo startup; the normal application command is unchanged.

Render start command: python scripts/start_team_demo.py
Required private configuration: DATA_DIR (absolute), DEMO_MODE=0, SEED_DEMO=0,
SECRET_KEY (stable, at least 32 characters), INITIAL_PASSWORD, ADMIN_USER, and
exactly one of TEAM_DEMO_USERS_JSON / TEAM_DEMO_USERS_FILE. ADMIN_PASSWORD is
required only to create the first administrator in an empty user table.
TEAM_DEMO_AS_OF optionally pins YYYY-MM-DD; otherwise uses Los Angeles today.
This profile uses DATA_DIR/app.db and local uploads. Free-instance data can be
lost on restart; an empty database is rebuilt. Existing team-demo work is kept.
Old or partial project sets require the separate explicit migration tool.
"""

from datetime import date, datetime
import json
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SCOPE = "team-v1"


def configuration(environ):
    """Validate before importing app modules that create directories or engines."""
    raw_dir = environ.get("DATA_DIR", "")
    if not raw_dir or not Path(raw_dir).is_absolute() or Path(raw_dir).resolve() == Path("/"):
        raise ValueError("团队演示需要显式绝对路径 DATA_DIR")
    data_dir = Path(raw_dir).resolve()
    if any(environ.get(key) != "0" for key in ("DEMO_MODE", "SEED_DEMO")):
        raise ValueError("团队演示必须显式设置 DEMO_MODE=0 和 SEED_DEMO=0")
    if len(environ.get("SECRET_KEY", "").strip()) < 32:
        raise ValueError("团队演示需要固定的至少 32 位 SECRET_KEY")
    if len(environ.get("INITIAL_PASSWORD", "")) < 6:
        raise ValueError("需要通过私有 INITIAL_PASSWORD 提供初始密码")
    if not environ.get("ADMIN_USER", "").strip():
        raise ValueError("需要显式 ADMIN_USER 标识演示管理员")
    database = data_dir / "app.db"
    if environ.get("DB_URL") not in (None, "", f"sqlite:///{database}"):
        raise ValueError("团队演示启动仅支持 DATA_DIR/app.db，不接受其他 DB_URL")
    if environ.get("STORAGE", "local") != "local":
        raise ValueError("团队演示启动仅支持本地附件存储")
    raw_json, roster_file = environ.get("TEAM_DEMO_USERS_JSON", ""), environ.get("TEAM_DEMO_USERS_FILE", "")
    if bool(raw_json) == bool(roster_file):
        raise ValueError("须且只能提供 TEAM_DEMO_USERS_JSON 或 TEAM_DEMO_USERS_FILE")
    try:
        roster = json.loads(raw_json if raw_json else Path(roster_file).read_text(encoding="utf-8"))
    except (ValueError, OSError):
        raise ValueError("无法读取私有演示名单或 JSON 格式错误") from None
    try:
        as_of = date.fromisoformat(environ["TEAM_DEMO_AS_OF"]) if environ.get("TEAM_DEMO_AS_OF") else datetime.now(ZoneInfo("America/Los_Angeles")).date()
        port = int(environ.get("PORT", "10000"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise ValueError("TEAM_DEMO_AS_OF 或 PORT 格式错误") from None
    return {"data_dir": data_dir, "database": database, "roster": roster, "as_of": as_of, "port": port}


def bootstrap(config):
    # All application imports follow the fail-closed environment check.
    sys.path.insert(0, str(ROOT / "backend"))
    sys.path.insert(0, str(ROOT / "scripts"))
    from sqlalchemy import select, text
    from app import models
    from app.auth import email_users, hash_password
    from app.db import SessionLocal, init_db
    from provision_users import provision_users, validate_records
    from prepare_team_demo import SLOTS, prepare_demo, resolve_team

    roster = validate_records(config["roster"])
    slots = [row["name"].casefold() for row in roster]
    if len(slots) != len(SLOTS) or set(slots) != set(SLOTS) or any(row["role"] != SLOTS[row["name"].casefold()] for row in roster):
        raise ValueError("演示名单须恰含已确认的七位员工及其职责角色")
    init_db()
    with SessionLocal.begin() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        # Never automatically migrate, delete, or combine old business projects.
        projects = list(db.execute(select(models.Project.id, models.Property.apn).join(models.Property)))
        expected = {f"TEAM-DEMO:{SCOPE}:{index}" for index in range(3)}
        if projects and (len(projects) != 3 or {apn for _, apn in projects} != expected):
            raise ValueError("存在旧项目或不完整演示，请先完成显式迁移；启动未修改账号")
        users = list(db.scalars(select(models.User)))
        if not users:
            password = os.environ.get("ADMIN_PASSWORD", "")
            if len(password) < 6:
                raise ValueError("空库需要私有 ADMIN_PASSWORD 创建首个管理员")
            admin = models.User(username=os.environ["ADMIN_USER"], display_name=os.environ["ADMIN_USER"],
                                role_code="负责人", is_admin=True, password_hash=hash_password(password))
            db.add(admin)
            db.flush()
        else:
            admins = [user for user in users if user.username == os.environ["ADMIN_USER"] and user.active and user.is_admin]
            if len(admins) != 1:
                raise ValueError("ADMIN_USER 未对应唯一启用管理员；不会改造现存账号")
            admin = admins[0]
        missing = []
        for row in roster:
            matches = email_users(db, row["email"])
            if len(matches) > 1:
                raise ValueError("员工邮箱有歧义，启动未导入账号")
            if not matches:
                missing.append(row)
        if projects and missing:
            raise ValueError("已有演示缺少参与账号，须先核对原任务与成员身份；不会另建 ID 替代")
        if missing:
            provision_users(db, missing, os.environ["INITIAL_PASSWORD"])
        # Also checks active roles and distinct IDs before committing any accounts.
        resolve_team(db, roster, admin.id)
        admin_id = admin.id
    # Generator owns its backup and SQLite write transaction. If it fails, do not
    # serve a partial demo; committed accounts are safely reused on the next run.
    result = prepare_demo(config["database"], config["data_dir"] / "uploads", roster, admin_id, config["as_of"],
                          apply=True, backup_dir=config["data_dir"] / "team-demo-backups", scope=SCOPE)
    return result["mode"]


def main():
    try:
        config = configuration(os.environ)
        bootstrap(config)
    except Exception:
        # SQL errors can contain private emails and hashes. Never print exceptions.
        print("团队演示启动未完成：请核对私有环境配置、管理员及员工角色、旧项目迁移和备份条件。服务未启动；未输出名单或数据库参数。", file=sys.stderr)
        return 1
    print("团队演示已就绪；已有账号及演示操作保持不变。", flush=True)
    os.execv(sys.executable, [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", str(ROOT / "backend"),
                             "--host", "0.0.0.0", "--port", str(config["port"])])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
