import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..analysis import build_prefill, full_outputs
from ..db import get_db
from .common import get_actor, require


def _guard(actor: str = Depends(get_actor)) -> None:
    require(actor, "analysis", what="看或改交易分析")

router = APIRouter(prefix="/api", tags=["analysis"], dependencies=[Depends(_guard)])


def _out(a: models.DealAnalysis) -> schemas.AnalysisOut:
    return schemas.AnalysisOut(
        id=a.id, project_id=a.project_id, name=a.name,
        inputs=json.loads(a.inputs_json or "{}"), outputs=json.loads(a.outputs_json or "{}"),
        is_current=a.is_current, created_at=a.created_at, updated_at=a.updated_at,
    )


def prefill_for_project(p: models.Project, tier: str = "medium") -> dict:
    prop = p.property
    # KAN-71：把房产字段的真实来源（主值行）交给预填，不让它自己写死 public_record/model。
    primary = {s.field: {"source": s.source, "confidence": s.confidence, "note": s.note}
               for s in prop.field_sources if s.is_primary}
    return build_prefill(
        sqft=prop.sqft, avm_value=prop.avm_value, list_price=prop.list_price, annual_tax=prop.annual_tax,
        purchase_price=p.purchase_price, target_arv=p.target_arv, tier=tier, field_sources=primary,
    )


def create_analysis(db: Session, p: models.Project, name: str | None, inputs: dict | None, tier: str = "medium",
                    make_current: bool = True) -> models.DealAnalysis:
    if inputs is None:
        inputs = prefill_for_project(p, tier)
    existing = db.scalars(select(models.DealAnalysis).where(models.DealAnalysis.project_id == p.id)).all()
    if make_current:
        for a in existing:
            a.is_current = False
    rec = models.DealAnalysis(
        project_id=p.id, name=name or f"分析 {len(existing) + 1}",
        inputs_json=json.dumps(inputs, ensure_ascii=False), outputs_json=json.dumps(full_outputs(inputs), ensure_ascii=False),
        is_current=make_current,
    )
    db.add(rec)
    db.flush()
    return rec


def _project(db: Session, project_id: int) -> models.Project:
    p = db.get(models.Project, project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p


@router.get("/projects/{project_id}/analyses/prefill", response_model=schemas.PrefillOut)
def prefill(project_id: int, tier: str = "medium", db: Session = Depends(get_db)):
    p = _project(db, project_id)
    inputs = prefill_for_project(p, tier)
    return schemas.PrefillOut(inputs=inputs, outputs=full_outputs(inputs))


@router.get("/projects/{project_id}/analyses", response_model=list[schemas.AnalysisOut])
def list_analyses(project_id: int, db: Session = Depends(get_db)):
    _project(db, project_id)
    rows = db.scalars(select(models.DealAnalysis).where(models.DealAnalysis.project_id == project_id)
                      .order_by(models.DealAnalysis.created_at)).all()
    return [_out(a) for a in rows]


@router.post("/projects/{project_id}/analyses", response_model=schemas.AnalysisOut, status_code=201)
def new_analysis(project_id: int, body: schemas.AnalysisCreate | None = None, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    body = body or schemas.AnalysisCreate()
    rec = create_analysis(db, p, body.name, body.inputs, body.tier)
    db.commit()
    db.refresh(rec)
    return _out(rec)


@router.get("/analyses/{aid}", response_model=schemas.AnalysisOut)
def get_analysis(aid: int, db: Session = Depends(get_db)):
    a = db.get(models.DealAnalysis, aid)
    if not a:
        raise HTTPException(404, "分析不存在")
    return _out(a)


@router.patch("/analyses/{aid}", response_model=schemas.AnalysisOut)
def patch_analysis(aid: int, body: schemas.AnalysisPatch, db: Session = Depends(get_db)):
    a = db.get(models.DealAnalysis, aid)
    if not a:
        raise HTTPException(404, "分析不存在")
    if body.name is not None:
        a.name = body.name
    if body.inputs is not None:
        a.inputs_json = json.dumps(body.inputs, ensure_ascii=False)
        a.outputs_json = json.dumps(full_outputs(body.inputs), ensure_ascii=False)
    if body.is_current:
        for other in db.scalars(select(models.DealAnalysis).where(models.DealAnalysis.project_id == a.project_id)).all():
            other.is_current = other.id == a.id
    db.commit()
    db.refresh(a)
    return _out(a)


@router.delete("/analyses/{aid}", status_code=204)
def delete_analysis(aid: int, db: Session = Depends(get_db)):
    a = db.get(models.DealAnalysis, aid)
    if not a:
        raise HTTPException(404, "分析不存在")
    db.delete(a)
    db.commit()


@router.post("/analyses/{aid}/apply", response_model=schemas.ProjectOut)
def apply_analysis(aid: int, body: schemas.AnalysisApplyIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    """把分析结果写回项目：目标售价、买入价；装修明细按类别汇总成预算项。"""
    from .common import log_update, project_out

    a = db.get(models.DealAnalysis, aid)
    if not a:
        raise HTTPException(404, "分析不存在")
    p = db.get(models.Project, a.project_id)
    inputs = json.loads(a.inputs_json or "{}")

    if body.apply_prices:
        if inputs.get("sale_price"):
            p.target_arv = float(inputs["sale_price"])
        if inputs.get("purchase_price"):
            p.purchase_price = float(inputs["purchase_price"])

    by_cat: dict[str, float] = {}
    for r in inputs.get("rehab_items") or []:
        cat = r.get("category") or "其他"
        by_cat[cat] = by_cat.get(cat, 0) + float(r.get("amount") or 0)
    if body.mode == "replace":
        for line in list(p.budget_lines):
            db.delete(line)
        db.flush()
    for cat, amt in by_cat.items():
        if amt > 0:
            db.add(models.BudgetLine(project_id=p.id, category=cat, planned_amount=round(amt, 2), note=f"来自{a.name}"))

    for other in p.analyses:
        other.is_current = other.id == a.id
    log_update(db, p.id, actor, "analysis", f"把“{a.name}”应用到项目：目标售价 ${p.target_arv or 0:,.0f}，预算项 {len(by_cat)} 类")
    db.commit()
    db.refresh(p)
    return project_out(db, p, actor)
