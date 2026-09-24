#!/usr/bin/env python3
"""按本机 JSON 名单导入账号；密码只从 INITIAL_PASSWORD 读取，不输出个人资料。

从仓库根目录：backend/.venv/bin/python scripts/provision_users.py users.local.json
在应用同一 DB_URL / DATA_DIR 环境执行；不创建项目、成员、邮件或演示数据。
"""

import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy.orm import Session

from app import models
from app.auth import email_users, hash_password, normalize_email
from app.dictionaries import ROLE_BY_CODE


def validate_records(records: object) -> list[dict[str, str]]:
    if not isinstance(records, list) or not records:
        raise ValueError("名单必须是非空 JSON 数组")
    normalized = []
    seen = set()
    for index, record in enumerate(records, 1):
        if not isinstance(record, dict) or not all(isinstance(record.get(k), str) for k in ("name", "email", "role")):
            raise ValueError(f"第 {index} 行需要 name、email、role 字符串")
        name, email, role = record["name"].strip(), normalize_email(record["email"]), record["role"].strip()
        if not name or email.count("@") != 1 or not all(email.split("@")) or any(c.isspace() for c in email):
            raise ValueError(f"第 {index} 行姓名或邮箱格式不对")
        if role not in ROLE_BY_CODE:
            raise ValueError(f"第 {index} 行角色未配置；请先确认角色映射")
        if email in seen:
            raise ValueError(f"第 {index} 行邮箱重复")
        seen.add(email)
        normalized.append({"name": name, "email": email, "role": role})
    return normalized


def provision_users(db: Session, records: object, password: str, *, reset_password: bool = False) -> dict[str, int]:
    """调用方提交事务；先校验整批，已有 ID/密码/管理员/启用状态与成员关系不变。"""
    rows = validate_records(records)
    if len(password) < 6:
        raise ValueError("INITIAL_PASSWORD 必须至少 6 位")
    prepared = []
    for index, row in enumerate(rows, 1):
        matches = email_users(db, row["email"])
        if len(matches) > 1:
            raise ValueError(f"第 {index} 行邮箱对应多个旧账号，未导入任何账号")
        prepared.append((row, matches[0] if matches else None))
    result = {"created": 0, "updated": 0, "passwords_reset": 0}
    for row, user in prepared:
        if user is None:
            # 邮箱可用作兼容登录名；永久主键和任务 / 成员外键仍是整数 User.id。
            user = models.User(username=row["email"], email=row["email"],
                               display_name=row["name"], role_code=row["role"],
                               password_hash=hash_password(password), is_admin=False)
            db.add(user)
            result["created"] += 1
        else:
            user.display_name = row["name"]
            user.role_code = row["role"]
            if reset_password:
                user.password_hash = hash_password(password)
                result["passwords_reset"] += 1
            result["updated"] += 1
    db.flush()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("users_file", type=Path)
    parser.add_argument("--reset-password", action="store_true", help="显式重置名单内已有账号的密码")
    args = parser.parse_args()
    try:
        records = validate_records(json.loads(args.users_file.read_text(encoding="utf-8")))
        password = os.environ.get("INITIAL_PASSWORD", "")
        if len(password) < 6:
            raise ValueError("请通过 INITIAL_PASSWORD 提供至少 6 位的初始密码")
        from app.db import SessionLocal
        with SessionLocal.begin() as db:
            result = provision_users(db, records, password, reset_password=args.reset_password)
        print(f"完成：新建 {result['created']}，更新 {result['updated']}，重置密码 {result['passwords_reset']}")
        return 0
    except (ValueError, OSError) as exc:
        # JSON 解码错误可能包含原始输入；只回显我们自己产生的校验消息。
        print(str(exc) if type(exc) is ValueError else "无法读取名单或 JSON 格式错误", file=sys.stderr)
    except Exception:
        # SQLAlchemy 错误可能含邮箱与 password_hash，不把 SQL 参数输出到终端。
        print("导入失败，事务已回滚。请确认服务已初始化数据库且 DB_URL / DATA_DIR 正确。", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
