from typing import Optional
import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from .common import allowed, get_actor, log_update, project_out, require, require_user, set_field_with_source

MONEY_FIELDS = {"purchase_price", "target_arv", "sale_price"}

DATE_LABEL = {"purchase_price": "买入价", "target_arv": "目标售价", "purchase_date": "买入日期", "construction_start": "开工日期",
              "construction_end": "计划完工", "list_date": "挂牌日期", "sale_date": "成交日期", "sale_price": "成交价",
              "stage": "阶段", "substage": "子阶段", "risks": "风险", "notes": "备注", "name": "项目名", "status_override": "状态覆盖"}

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("/creation-members")
def creation_members(db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    """新项目尚无成员；只给可分派账号读取最小候选信息，不暴露邮箱。"""
    require(me.role_code, "assign_tasks", what="安排新项目任务")
    from .tasks import _brief
    return [_brief(u) for u in db.scalars(select(models.User).where(models.User.active.is_(True)).order_by(models.User.display_name, models.User.id))]



def _get(db: Session, project_id: int) -> models.Project:
    p = db.get(models.Project, project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p


@router.get("", response_model=list[schemas.ProjectOut])
def list_projects(stage: Optional[str] = None, q: Optional[str] = None, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    stmt = select(models.Project).order_by(models.Project.updated_at.desc())
    if stage:
        stmt = stmt.where(models.Project.stage == stage)
    items = db.scalars(stmt).all()
    if q:
        ql = q.lower()
        items = [p for p in items if ql in p.name.lower() or ql in p.property.address_std.lower()]
    return [project_out(db, p, actor) for p in items]


@router.post("", response_model=schemas.ProjectOut, status_code=201)
def create_project(body: schemas.ProjectCreate, request: Request, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "create_project", what="新建项目")
    from ..auth import current_user
    from .tasks import ORDINARY_ITEMS
    creator = current_user(request, db)
    if (body.task_plan or body.request_key) and creator is None:
        raise HTTPException(401, "请登录后安排新项目任务")
    fingerprint = hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def replay():
        rec = db.scalar(select(models.ProjectCreation).where(
            models.ProjectCreation.user_id == creator.id, models.ProjectCreation.request_key == str(body.request_key)))
        if rec is None:
            return None
        if rec.fingerprint != fingerprint:
            raise HTTPException(409, "这次创建已提交，但内容不同。请先查看已创建项目，不要重复创建。")
        project = db.get(models.Project, rec.project_id)
        if project is None:
            raise HTTPException(409, "这次请求的项目已被删除，请重新开始新建流程")
        return project_out(db, project, actor)

    if body.request_key:
        previous = replay()
        if previous is not None:
            return previous
    targets = {}
    if body.task_plan:
        require(creator.role_code, "assign_tasks", what="预安排任务")
        ordinary = {it["key"] for _, it in ORDINARY_ITEMS}
        keys = [p.step_key for p in body.task_plan]
        if len(keys) != len(set(keys)) or set(keys) - ordinary:
            raise HTTPException(400, "预安排只能包含不重复的普通模板任务，关键节点单独确认")
        for uid in {p.assignee_user_id for p in body.task_plan if p.assignee_user_id is not None}:
            target = db.get(models.User, uid)
            if target is None or not target.active:
                raise HTTPException(400, "安排中的账号不存在或已停用，请重新选择负责人")
            if uid != creator.id and not body.join_assignees:
                raise HTTPException(400, "请确认将所选负责人加入新项目并分派任务")
            targets[uid] = target
    receipt = None
    try:
        if body.request_key:
            receipt = models.ProjectCreation(user_id=creator.id, request_key=str(body.request_key), fingerprint=fingerprint)
            db.add(receipt)
            db.flush()  # 唯一约束在并发请求下也保护整个创建事务。
        project = _create_with_plan(body, db, actor, creator, targets, receipt)
        db.commit()
    except IntegrityError:
        db.rollback()
        if body.request_key:
            previous = replay()
            if previous is not None:
                return previous
        raise
    except Exception:
        db.rollback()
        raise
    db.refresh(project)
    return project_out(db, project, actor)


def _create_with_plan(body, db, actor, creator, targets, receipt):
    prop = None
    if body.reuse_property_id:
        prop = db.get(models.Property, body.reuse_property_id)
    if prop is None:
        prop = models.Property(
            address_std=body.address.label, street=body.address.street, city=body.address.city,
            state=body.address.state, zip=body.address.zip, lat=body.address.lat, lng=body.address.lng,
            apn=body.apn,
        )
        db.add(prop)
        db.flush()
        for f in body.fields:
            set_field_with_source(db, prop, f.field, f.value, f.source, f.confidence, f.note, make_primary=True)
        if body.owner:
            db.add(models.Owner(property_id=prop.id, **{k: body.owner.get(k) for k in ("name", "mailing_address", "phone", "email", "owner_since")}))
        for m in body.mortgages:
            db.add(models.Mortgage(property_id=prop.id, **{k: m.get(k) for k in ("recording_date", "lender", "loan_type", "term_months", "original_balance", "est_balance", "rate", "payment")}))
        for s in body.sales_history:
            db.add(models.SalesHistory(property_id=prop.id, **{k: s.get(k) for k in ("recording_date", "seller", "buyer", "doc_type", "amount")}))

    project = models.Project(
        property_id=prop.id, name=body.name or body.address.street, strategy=body.strategy,
        stage=body.stage, substage=body.substage, lead_heat=body.lead_heat,
        purchase_price=body.purchase_price, target_arv=body.target_arv, purchase_date=body.purchase_date,
        construction_start=body.construction_start, construction_end=body.construction_end,
        risks=body.risks, notes=body.notes,
    )
    db.add(project)
    db.flush()
    if body.create_analysis:
        from .analyses import create_analysis
        create_analysis(db, project, None, None)
    from .procurement import ensure_procurement
    ensure_procurement(db, project.id, commit=False)
    # KAN-75：所有普通模板任务都建成实例（未分派也建），创建者自动成为项目成员。
    from .tasks import ensure_member, ensure_tasks
    tasks = ensure_tasks(db, project.id, commit=False)
    if creator is not None:
        ensure_member(db, project.id, creator, creator)
    if body.task_plan:
        from .tasks import _event
        by_key = {t.step_key: t for t in tasks}
        joined = {creator.id}
        for plan in body.task_plan:
            t = by_key[plan.step_key]
            if plan.assignee_user_id is not None:
                target = targets[plan.assignee_user_id]
                if target.id not in joined:
                    ensure_member(db, project.id, target, creator)
                    joined.add(target.id)
                    _event(db, t, project.id, "member_added", creator, after={"user_id": target.id, "role_code": target.role_code})
                t.assignee_user_id = target.id
                t.reviewer_user_id = creator.id
                _event(db, t, project.id, "assigned", creator,
                       after={"assignee_user_id": target.id, "reviewer_user_id": creator.id, "exec_status": "not_started"})
            if plan.due_at:
                t.due_at = plan.due_at.isoformat()
                _event(db, t, project.id, "rescheduled", creator, after={"due_at": t.due_at})
    if receipt is not None:
        receipt.project_id = project.id
    log_update(db, project.id, actor, "project", f"新建了项目：{project.name}")
    return project


@router.get("/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    return project_out(db, _get(db, project_id), actor)


@router.patch("/{project_id}", response_model=schemas.ProjectOut)
def patch_project(project_id: int, body: schemas.ProjectPatch, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    p = _get(db, project_id)
    data = body.model_dump(exclude_unset=True)
    clear = data.pop("clear_status_override", False)
    data.pop("stage", None)                      # 阶段由清单派生，不再手改
    if p.stage != "lead":
        data.pop("substage", None)               # 只有线索段的子阶段（联系卖家 / 约看 / 已出价）还手改
        data.pop("lead_heat", None)              # 热度只对线索有意义。KAN-50 之前这里不挡，
                                                 # EditProjectModal 会把非线索项目的热度默认成 warm_lead 一起发过来
    if MONEY_FIELDS & set(data):
        require(actor, "edit_money", what="改价格")
    if set(data) - MONEY_FIELDS or clear:
        require(actor, "edit_project", what="改项目信息")
    changed = [DATE_LABEL.get(k, k) for k, v in data.items() if getattr(p, k) != v]
    for k, v in data.items():
        setattr(p, k, v)
    if clear:
        p.status_override = None
        p.status_override_reason = None
    if changed:
        log_update(db, project_id, actor, "project", f"修改了{'、'.join(changed[:4])}{'等' if len(changed) > 4 else ''}")
    db.commit()
    db.refresh(p)
    return project_out(db, p, actor)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    require(actor, "delete_project", what="删除项目")
    p = _get(db, project_id)
    db.delete(p)
    db.commit()
