"""水电瓦斯账户与施工检查记录：各人自己填，负责人看。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..dictionaries import INSPECTION_RESULTS, UTILITY_KINDS, UTILITY_STATUSES
from .common import allowed, get_actor, log_update, require

router = APIRouter(prefix="/api", tags=["ops"])

KIND_LABEL = {u["value"]: u["label"] for u in UTILITY_KINDS}
STATUS_LABEL = {u["value"]: u["label"] for u in UTILITY_STATUSES}
RESULT_LABEL = {r["value"]: r["label"] for r in INSPECTION_RESULTS}


def _project(db: Session, project_id: int) -> models.Project:
    p = db.get(models.Project, project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p


# ---------- 水电瓦斯 ----------
@router.get("/projects/{project_id}/utilities", response_model=list[schemas.UtilityOut])
def list_utilities(project_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    """总是返回三行（水 / 电 / 瓦斯），没填过的给空行，前端直接编辑。账户密码只给紫、蓝和 K。"""
    p = _project(db, project_id)
    by = {u.kind: u for u in p.utilities}
    out = []
    for k in UTILITY_KINDS:
        u = by.get(k["value"])
        if u is None:
            u = models.UtilityAccount(project_id=project_id, kind=k["value"], status="not_started")
            db.add(u)
        out.append(u)
    db.commit()
    for u in out:
        db.refresh(u)
    if allowed(actor, "utility_secret"):
        return out
    return [schemas.UtilityOut.model_validate(u).model_copy(update={"password": None}) for u in out]


@router.put("/projects/{project_id}/utilities/{kind}", response_model=list[schemas.UtilityOut])
def save_utility(project_id: int, kind: str, body: schemas.UtilityIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "utilities", what="填水电瓦斯账户")
    _project(db, project_id)
    if kind not in KIND_LABEL:
        raise HTTPException(400, "只有水、电、瓦斯三种")
    if body.status not in STATUS_LABEL:
        raise HTTPException(400, "状态不对")
    rec = db.scalar(select(models.UtilityAccount).where(models.UtilityAccount.project_id == project_id, models.UtilityAccount.kind == kind))
    if rec is None:
        rec = models.UtilityAccount(project_id=project_id, kind=kind)
        db.add(rec)
    for k, v in body.model_dump().items():
        setattr(rec, k, v)
    rec.updated_by = actor
    text = f"更新了{KIND_LABEL[kind]}的账户：{STATUS_LABEL[body.status]}"
    if body.company:
        text += f"，{body.company}"
    if body.opened_under:
        text += f"，用 {body.opened_under} 的名字开的"
    if body.blocker:
        text += f"，卡在：{body.blocker}"
    log_update(db, project_id, actor, "utility", text)
    db.commit()
    return list_utilities(project_id, db, actor)


# ---------- 检查记录 ----------
def _inspections(db: Session, project_id: int) -> list[models.Inspection]:
    rows = db.scalars(select(models.Inspection).where(models.Inspection.project_id == project_id)).all()
    return sorted(rows, key=lambda r: (r.date is None, r.date or "", r.id))


@router.get("/projects/{project_id}/inspections", response_model=list[schemas.InspectionOut])
def list_inspections(project_id: int, db: Session = Depends(get_db)):
    _project(db, project_id)
    return _inspections(db, project_id)


@router.post("/projects/{project_id}/inspections", response_model=list[schemas.InspectionOut], status_code=201)
def add_inspection(project_id: int, body: schemas.InspectionIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "inspections", what="记检查")
    _project(db, project_id)
    if body.result not in RESULT_LABEL:
        raise HTTPException(400, "结果不对")
    rec = models.Inspection(project_id=project_id, recorded_by=actor, **body.model_dump())
    db.add(rec)
    log_update(db, project_id, actor, "inspection", f"记了一次检查：{body.name} · {RESULT_LABEL[body.result]}" + ("（final）" if body.is_final else ""))
    db.commit()
    return _inspections(db, project_id)


@router.patch("/inspections/{inspection_id}", response_model=list[schemas.InspectionOut])
def patch_inspection(inspection_id: int, body: schemas.InspectionPatch, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "inspections", what="改检查记录")
    rec = db.get(models.Inspection, inspection_id)
    if not rec:
        raise HTTPException(404, "检查记录不存在")
    data = body.model_dump(exclude_unset=True)
    if "result" in data and data["result"] not in RESULT_LABEL:
        raise HTTPException(400, "结果不对")
    for k, v in data.items():
        setattr(rec, k, v)
    log_update(db, rec.project_id, actor, "inspection", f"更新了检查：{rec.name} · {RESULT_LABEL.get(rec.result, rec.result)}" + (f"，{rec.fixer} 整改" if rec.result == "failed" and rec.fixer else ""))
    db.commit()
    return _inspections(db, rec.project_id)


@router.delete("/inspections/{inspection_id}", response_model=list[schemas.InspectionOut])
def delete_inspection(inspection_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "inspections", what="删检查记录")
    rec = db.get(models.Inspection, inspection_id)
    if not rec:
        raise HTTPException(404, "检查记录不存在")
    pid = rec.project_id
    log_update(db, pid, actor, "inspection", f"删掉了检查记录：{rec.name}")
    db.delete(rec)
    db.commit()
    return _inspections(db, pid)
