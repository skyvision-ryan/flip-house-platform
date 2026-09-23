"""一次性数据迁移（KAN-71 起）。

**不放进 db.init_db()**——那里只管建表和补列，测试也会调它。这里由 main.py 的 lifespan 在
init_db() 之后、seed 之前调一次；也能从命令行跑：

    python -m app.migrations --dry-run   # 只打印每条会命中多少行，不落库、不写戳记
    python -m app.migrations             # 正式执行

每条迁移三层防护，从强到弱：

1. **戳记表** `app_migrations(key, applied_at, affected)`：key 存在就跳过。这是幂等的真正来源——
   跑过一次就永不再动，所以上线后新写入的任何真实数据天然免疫。
2. **指纹 WHERE**：不写 `WHERE source='public_record'` 那种宽条件，而是按 (field, source, confidence)
   命中 MockProvider 的固定映射。**指纹写成本模块的常量，不 import providers.mock**——否则将来
   改 mock 会静默改掉迁移语义。
3. **环境闸门**：只在演示配置下才跑。它不是安全保证，别把它当主防线——settings.py 和
   providers/__init__.py 的 PROVIDER 默认值都是 "mock"，没配变量的真实部署也满足这个条件。
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from .settings import PROVIDER, SEED_DEMO

MARKER_TABLE = "app_migrations"


@dataclass
class Report:
    key: str
    status: str      # applied / skipped-already-applied / skipped-not-demo / dry-run
    affected: int


def _ensure_marker_table(db: Session) -> None:
    db.execute(text(
        f"CREATE TABLE IF NOT EXISTS {MARKER_TABLE} ("
        "key TEXT PRIMARY KEY, applied_at TEXT NOT NULL, affected INTEGER NOT NULL)"
    ))


def _applied(db: Session, key: str) -> bool:
    _ensure_marker_table(db)
    return db.execute(text(f"SELECT 1 FROM {MARKER_TABLE} WHERE key = :k"), {"k": key}).first() is not None


def _stamp(db: Session, key: str, affected: int) -> None:
    db.execute(text(f"INSERT INTO {MARKER_TABLE} (key, applied_at, affected) VALUES (:k, :t, :n)"),
               {"k": key, "t": datetime.now().isoformat(timespec="seconds"), "n": affected})


# ---------------- KAN-71：模拟数据不再冒充公共记录 ----------------

KAN71_KEY = "kan71_demo_source"

# MockProvider 在 KAN-71 之前写库时用的 (field, source, confidence)。只有**精确命中**这张表的行
# 才能确认是 Mock 写的，改成 demo；不命中的 public_record / model 行来源无法确认，改成 unverified。
# 这张表是历史事实的快照，**不要**改成从 mock.py 读——mock 已经不再发这些值了。
KAN71_MOCK_FINGERPRINT: tuple[tuple[str, str, float], ...] = (
    ("property_type", "public_record", 0.95),
    ("style", "public_record", 0.7),
    ("year_built", "public_record", 0.95),
    ("sqft", "public_record", 0.9),
    ("beds", "public_record", 0.9),
    ("baths_full", "public_record", 0.9),
    ("baths_half", "public_record", 0.8),
    ("stories", "public_record", 0.85),
    ("garage_spaces", "public_record", 0.8),
    ("basement", "public_record", 0.8),
    ("lot_sqft", "public_record", 0.95),
    ("land_use", "public_record", 0.95),
    ("apn", "public_record", 0.99),          # 含 routers/projects.py 旧兜底写的那条，签名相同
    ("avm_value", "model", 0.75),
    ("list_price", "public_record", 0.9),
    ("annual_tax", "public_record", 0.95),
)

# 来源无法确认的行改成这一档。manual / lark / demo / unverified / ai 一律不碰。
KAN71_UNCONFIRMED_SOURCES = ("public_record", "model")


def _kan71_counts(db: Session) -> tuple[int, int]:
    """(指纹命中数, 不命中但来源无法确认数)。只读。"""
    hit = 0
    for field, source, conf in KAN71_MOCK_FINGERPRINT:
        hit += db.execute(text(
            "SELECT COUNT(*) FROM property_field_sources "
            "WHERE field = :f AND source = :s AND confidence = :c"
        ), {"f": field, "s": source, "c": conf}).scalar_one()
    # 不命中的：来源在待确认集合里，但 (field, source, confidence) 不在指纹表里
    unconfirmed = db.execute(
        text("SELECT COUNT(*) FROM property_field_sources WHERE source IN :srcs")
        .bindparams(bindparam("srcs", expanding=True)),
        {"srcs": list(KAN71_UNCONFIRMED_SOURCES)},
    ).scalar_one() - hit
    return hit, max(unconfirmed, 0)


def migrate_kan71_demo_source(db: Session, *, dry_run: bool = False) -> Report:
    _ensure_marker_table(db)   # 建表是 IF NOT EXISTS，dry-run 也建，但不写戳记
    if not dry_run and _applied(db, KAN71_KEY):
        return Report(KAN71_KEY, "skipped-already-applied", 0)
    if not (SEED_DEMO and (PROVIDER or "mock").lower() == "mock"):
        return Report(KAN71_KEY, "skipped-not-demo", 0)

    hit, unconfirmed = _kan71_counts(db)
    if dry_run:
        print(f"[dry-run] {KAN71_KEY}：指纹命中 {hit} 行 → demo；来源无法确认 {unconfirmed} 行 → unverified")
        return Report(KAN71_KEY, "dry-run", hit + unconfirmed)

    affected = 0
    # 第一步：指纹命中 → demo，把握度置空（随机值谈不上把握度）
    for field, source, conf in KAN71_MOCK_FINGERPRINT:
        r = db.execute(text(
            "UPDATE property_field_sources SET source = 'demo', confidence = NULL "
            "WHERE field = :f AND source = :s AND confidence = :c"
        ), {"f": field, "s": source, "c": conf})
        affected += r.rowcount
    # 第二步：剩下的 public_record / model 来源无法确认 → unverified，**不重新猜一个来源**
    r = db.execute(
        text("UPDATE property_field_sources SET source = 'unverified', confidence = NULL WHERE source IN :srcs")
        .bindparams(bindparam("srcs", expanding=True)),
        {"srcs": list(KAN71_UNCONFIRMED_SOURCES)},
    )
    affected += r.rowcount

    _stamp(db, KAN71_KEY, affected)
    db.commit()
    return Report(KAN71_KEY, "applied", affected)


# ---------------- 入口 ----------------

MIGRATIONS = (migrate_kan71_demo_source,)


def run_migrations(db: Session, *, dry_run: bool = False) -> list[Report]:
    """按顺序跑全部迁移。每条自己判断要不要跑，自己 commit。"""
    return [m(db, dry_run=dry_run) for m in MIGRATIONS]


if __name__ == "__main__":
    from .db import SessionLocal, init_db

    dry = "--dry-run" in sys.argv
    init_db()
    with SessionLocal() as session:
        for rep in run_migrations(session, dry_run=dry):
            print(f"{rep.key}: {rep.status}, affected={rep.affected}")
