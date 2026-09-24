"""采购清单：按节点波次管理选型 / 下单 / 到货 / 异常。"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..dictionaries import PROCUREMENT_STATUSES, PROCUREMENT_TEMPLATE
from .common import get_actor, log_update, require

router = APIRouter(prefix="/api", tags=["procurement"])

_STATUS_OK = {s["value"] for s in PROCUREMENT_STATUSES}


def _project(db: Session, project_id: int) -> models.Project:
    p = db.get(models.Project, project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p


def _rows(db: Session, project_id: int) -> list[models.ProcurementItem]:
    return list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id).order_by(models.ProcurementItem.sort_order, models.ProcurementItem.id)).all())


def ensure_procurement(db: Session, project_id: int, *, commit: bool = True) -> list[models.ProcurementItem]:
    """按模板灌入行（建项目 / 初始化接口 / seed 用）；已有则原样返回。不在 GET 里调。"""
    rows = list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id).order_by(models.ProcurementItem.sort_order, models.ProcurementItem.id)).all())
    if rows:
        return rows
    for i, t in enumerate(PROCUREMENT_TEMPLATE):
        db.add(models.ProcurementItem(project_id=project_id, wave=t["wave"], name=t["name"], status="pending_spec", sort_order=i))
    db.commit() if commit else db.flush()
    return list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id).order_by(models.ProcurementItem.sort_order, models.ProcurementItem.id)).all())


def _summary(rows: list[models.ProcurementItem]) -> dict:
    counts = {s["value"]: 0 for s in PROCUREMENT_STATUSES}
    for r in rows:
        counts[r.status] = counts.get(r.status, 0) + 1
    return {
        "total": len(rows),
        "pending_spec": counts.get("pending_spec", 0),
        "pending_order": counts.get("pending_order", 0),
        "ordered": counts.get("ordered", 0),
        "received": counts.get("received", 0),
        "exception": counts.get("exception", 0),
        "na": counts.get("na", 0),
    }


@router.get("/projects/{project_id}/procurement", response_model=schemas.ProcurementListOut)
def list_procurement(project_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "procurement", what="看采购清单")
    _project(db, project_id)
    rows = _rows(db, project_id)   # 只读：没有行就返回空，前端给“按模板初始化”
    return schemas.ProcurementListOut(items=rows, summary=_summary(rows), template_missing=not rows)


@router.post("/projects/{project_id}/procurement/init", response_model=schemas.ProcurementListOut)
def init_procurement(project_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "procurement", what="初始化采购清单")
    _project(db, project_id)
    had = bool(_rows(db, project_id))
    rows = ensure_procurement(db, project_id)
    if not had:
        log_update(db, project_id, actor, "procurement", f"按采购表模板建了 {len(rows)} 行采购清单")
        db.commit()
    return schemas.ProcurementListOut(items=rows, summary=_summary(rows), template_missing=False)


@router.patch("/procurement/{item_id}", response_model=schemas.ProcurementListOut)
def patch_procurement(item_id: int, body: schemas.ProcurementPatchIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "procurement", what="改采购状态")
    row = db.get(models.ProcurementItem, item_id)
    if not row:
        raise HTTPException(404, "采购项不存在")
    if body.status is not None:
        if body.status not in _STATUS_OK:
            raise HTTPException(400, "未知采购状态")
        row.status = body.status
    if body.note is not None:
        row.note = body.note or None
    row.updated_by = actor
    row.updated_at = datetime.now().isoformat(timespec="seconds")
    label = next((s["label"] for s in PROCUREMENT_STATUSES if s["value"] == row.status), row.status)
    log_update(db, row.project_id, actor, "procurement", f"采购「{row.name}」→ {label}" + (f"：{body.note}" if body.note else ""))
    db.commit()
    rows = list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == row.project_id).order_by(models.ProcurementItem.sort_order, models.ProcurementItem.id)).all())
    return schemas.ProcurementListOut(items=rows, summary=_summary(rows))
