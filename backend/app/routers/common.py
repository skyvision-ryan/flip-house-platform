"""路由共用的序列化与计算。"""

from typing import Optional
from urllib.parse import unquote

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import current_user
from ..db import get_db
from ..dictionaries import KEY_FIELDS_FOR_COMPLETENESS, PERMISSIONS, PROPERTY_FIELDS, tier_of
from ..settings import DEMO_MODE
from ..status import compute_status
from ..steps import compute_steps, sync_legacy_stage

FIELD_TYPES = {f["key"]: f["type"] for f in PROPERTY_FIELDS}
FIELD_LABELS = {f["key"]: f["label"] for f in PROPERTY_FIELDS}


def get_actor(request: Request, db: Session = Depends(get_db), x_actor: Optional[str] = Header(default=None)) -> str:
    """当前操作人的角色代号。

    登录了：用账号绑定的角色代号；管理员在演示模式下可以用 X-Actor 头临时切身份（顶栏“我是”）。
    没登录：演示模式接受 X-Actor（默认负责人）；正式模式一律 401。
    """
    u = current_user(request, db)
    if u is not None:
        if DEMO_MODE and u.is_admin and x_actor:
            return unquote(x_actor)
        return u.role_code
    if DEMO_MODE:
        return unquote(x_actor) if x_actor else "负责人"
    raise HTTPException(401, "还没登录")


def require_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    """KAN-75：写任务的接口要真登录。演示模式的 X-Actor 只能改「看」，不能替人「做」。"""
    u = current_user(request, db)
    if u is None:
        raise HTTPException(401, "这个操作要先登录")
    return u


def allowed(actor: str, action: str, *extra_ok: str) -> bool:
    """这个身份能不能做这个动作：级别在名单里、代号在名单里、或调用方额外放行的代号。"""
    ok = PERMISSIONS.get(action, ["purple", "blue"])
    return tier_of(actor) in ok or actor in ok or actor in extra_ok


def require(actor: str, action: str, *extra_ok: str, what: str | None = None) -> None:
    if not allowed(actor, action, *extra_ok):
        raise HTTPException(403, f"{actor} 没有权限{what or action}")


def can_read_money(actor: str) -> bool:
    return allowed(actor, "read_money")


def log_update(db: Session, project_id: int, actor: str, kind: str, text: str) -> None:
    """谁改了什么，记一条给负责人看。调用方负责 commit。"""
    db.add(models.ProjectUpdate(project_id=project_id, actor=actor or "负责人", kind=kind, text=text))


def cast_value(field: str, value):
    if value is None or value == "":
        return None
    t = FIELD_TYPES.get(field, "text")
    if t == "int":
        try:
            return int(float(str(value).replace(",", "")))
        except ValueError:
            return None
    return str(value)


def budget_totals(db: Session, project_id: int) -> tuple[float, float]:
    planned = db.scalar(select(func.coalesce(func.sum(models.BudgetLine.planned_amount), 0)).where(models.BudgetLine.project_id == project_id)) or 0
    spent = db.scalar(select(func.coalesce(func.sum(models.Expense.amount), 0)).where(models.Expense.project_id == project_id)) or 0
    return float(planned), float(spent)


def project_out(db: Session, p: models.Project, actor: str = "负责人") -> schemas.ProjectOut:
    planned, spent = budget_totals(db, p.id)
    hide = not can_read_money(actor)
    steps = compute_steps(db, p, hide_money=hide)
    if sync_legacy_stage(db, p, steps):
        db.commit()
    status, reason = compute_status(p, planned, spent)
    if hide and "$" in reason:
        reason = "支出超预算（金额对你隐藏）" if status == "at_risk" else reason
    prop = p.property
    missing = [FIELD_LABELS[k] for k in KEY_FIELDS_FOR_COMPLETENESS if getattr(prop, k) in (None, "")]
    if not hide and p.stage != "lead" and p.purchase_price is None:
        missing.append("买入价")
    if not hide and p.target_arv is None:
        missing.append("目标售价（ARV）")
    return schemas.ProjectOut(
        id=p.id, name=p.name, strategy=p.strategy, stage=p.stage, substage=p.substage,
        lead_heat=p.lead_heat, status=status, status_reason=reason,
        status_override=p.status_override, status_override_reason=p.status_override_reason,
        purchase_price=None if hide else p.purchase_price, target_arv=None if hide else p.target_arv, purchase_date=p.purchase_date,
        construction_start=p.construction_start, construction_end=p.construction_end,
        list_date=p.list_date, sale_date=p.sale_date, sale_price=None if hide else p.sale_price,
        risks=p.risks, notes=p.notes, created_at=p.created_at, updated_at=p.updated_at,
        property=schemas.PropertyBrief.model_validate(prop),
        budget_planned=None if hide else planned, budget_spent=None if hide else spent,
        budget_used_pct=(None if hide else (round(spent / planned * 100, 1) if planned > 0 else None)),
        money_hidden=hide,
        missing_fields=missing,
        analysis_count=0 if hide else len(p.analyses),
        current_stage=steps["current_stage"], next_up=steps["next_up"],
        stage_progress=steps["stage_progress"], earlier_undone_count=len(steps["earlier_undone"]),
        group_position=steps["group_position"], lead_substage_at_escrow=p.lead_substage_at_escrow,
    )


def set_field_with_source(db: Session, prop: models.Property, field: str, value, source: str,
                          confidence=None, note=None, make_primary: bool = True) -> models.PropertyFieldSource:
    """写一条来源记录；若 make_primary 则设为主值并写回 properties 列。"""
    if make_primary:
        for s in prop.field_sources:
            if s.field == field:
                s.is_primary = False
    rec = models.PropertyFieldSource(
        property_id=prop.id, field=field, value=(None if value is None else str(value)),
        source=source, confidence=confidence, note=note, is_primary=make_primary,
    )
    db.add(rec)
    # KAN-71：同时挂到集合上。建项目时 create_analysis 在同一事务里读 prop.field_sources 取来源，
    # 只 db.add 不 append 的话它读到的是空集合，分析器就会退回「待核实」。
    prop.field_sources.append(rec)
    if make_primary and hasattr(prop, field):
        setattr(prop, field, cast_value(field, value))
    return rec
