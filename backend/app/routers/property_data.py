from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..dictionaries import PROPERTY_FIELDS
from .common import cast_value, get_actor, log_update, require, set_field_with_source

FIELD_LABEL = {f["key"]: f["label"] for f in PROPERTY_FIELDS}

router = APIRouter(prefix="/api/projects/{project_id}/property", tags=["property"])


def _prop(db: Session, project_id: int) -> models.Property:
    p = db.get(models.Project, project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p.property


def _out(prop: models.Property) -> schemas.PropertyDataOut:
    by_field: dict[str, list[models.PropertyFieldSource]] = {}
    for s in prop.field_sources:
        by_field.setdefault(s.field, []).append(s)
    fields = []
    for f in PROPERTY_FIELDS:
        srcs = sorted(by_field.get(f["key"], []), key=lambda s: (not s.is_primary, s.fetched_at), reverse=False)
        primary = next((s for s in srcs if s.is_primary), None)
        distinct = {(s.value or "").strip().lower() for s in srcs if s.value not in (None, "")}
        val = getattr(prop, f["key"])
        fields.append(schemas.PropertyFieldOut(
            key=f["key"], label=f["label"], type=f["type"],
            value=None if val is None else str(val),
            primary_source=primary.source if primary else None,
            sources=[schemas.SourceOut.model_validate(s) for s in srcs],
            has_conflict=len(distinct) > 1,
        ))
    return schemas.PropertyDataOut(
        property=schemas.PropertyBrief.model_validate(prop),
        fields=fields,
        owner=schemas.OwnerOut.model_validate(prop.owner) if prop.owner else None,
        mortgages=[schemas.MortgageOut.model_validate(m) for m in prop.mortgages],
        sales_history=[schemas.SalesHistoryOut.model_validate(s) for s in prop.sales_history],
    )


@router.get("", response_model=schemas.PropertyDataOut)
def get_property(project_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    return _out(_prop(db, project_id))


@router.patch("", response_model=schemas.PropertyDataOut)
def patch_field(project_id: int, body: schemas.FieldPatch, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "edit_project", what="改房产数据")
    prop = _prop(db, project_id)
    if body.field not in {f["key"] for f in PROPERTY_FIELDS}:
        raise HTTPException(400, "未知字段")
    set_field_with_source(db, prop, body.field, body.value, "manual", 1.0, f"{actor} 修改", make_primary=True)
    log_update(db, project_id, actor, "data", f"把“{FIELD_LABEL.get(body.field, body.field)}”改成 {body.value if body.value not in (None, '') else '空'}")
    db.commit()
    db.refresh(prop)
    return _out(prop)


@router.post("/fields/{field}/primary", response_model=schemas.PropertyDataOut)
def set_primary(project_id: int, field: str, body: schemas.PrimaryIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "edit_project", what="改房产数据")
    prop = _prop(db, project_id)
    target = None
    for s in prop.field_sources:
        if s.field == field:
            s.is_primary = s.id == body.source_id
            if s.is_primary:
                target = s
    if target is None:
        raise HTTPException(404, "来源记录不存在")
    setattr(prop, field, cast_value(field, target.value))
    log_update(db, project_id, actor, "data", f"“{FIELD_LABEL.get(field, field)}”选用了{target.source}来源的值 {target.value}")
    db.commit()
    db.refresh(prop)
    return _out(prop)
