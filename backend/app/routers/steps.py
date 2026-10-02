"""阶段清单与更新记录。"""
from ..task_evidence import capture_evidence, commit_evidence

import json
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..auth import current_user
from ..dictionaries import ITEM_EVIDENCE, STAGE_CHECKLIST, SUBSTAGES
from ..steps import compute_steps
from .common import allowed, can_read_money, get_actor, log_update, require_project_read, visible_project_ids

MONEY_RE = re.compile(r"\$[\d,]+(?:\.\d+)?")

router = APIRouter(prefix="/api", tags=["steps"])

ITEM_TITLE = {it["key"]: it["title"] for st in STAGE_CHECKLIST for it in st["items"]}
ITEM_CONFIRM = {it["key"]: it.get("confirm") or [] for st in STAGE_CHECKLIST for it in st["items"]}
ITEM_OWNERS = {it["key"]: it["owners"] for st in STAGE_CHECKLIST for it in st["items"]}


def _project(db: Session, project_id: int) -> models.Project:
    p = db.get(models.Project, project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p


@router.get("/projects/{project_id}/steps", response_model=schemas.StepsOut)
def get_steps(project_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    return compute_steps(db, _project(db, project_id), hide_money=not can_read_money(actor))


@router.post("/projects/{project_id}/steps/{key}", response_model=schemas.StepsOut)
def toggle_step(project_id: int, key: str, body: schemas.StepToggleIn, request: Request, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    evidence_before = capture_evidence(db, project_id)
    p = _project(db, project_id)
    if key not in ITEM_TITLE:
        raise HTTPException(400, "未知清单项")
    from ..dictionaries import SINGLE_CONFIRM_KEYS
    if key in SINGLE_CONFIRM_KEYS:
        from .common import require_user
        from .tasks import ensure_tasks, confirm_node
        me = require_user(request, db)
        if not body.done:
            raise HTTPException(409, "确认历史不能取消；前置资料变化会显示待复核")
        t = next(t for t in ensure_tasks(db, project_id) if t.step_key == key)
        confirm_node(db, project_id, t, me)
        return compute_steps(db, p, hide_money=not can_read_money(actor))
    confirm = ITEM_CONFIRM[key]
    store_key = key
    who_label = actor
    if key == "final" and body.done:
        # final 这道门要有验收通过的记录才能确认；最近一次 final 检查没过也不行
        finals = sorted([i for i in p.inspections if i.is_final], key=lambda i: (i.date or "", i.id))
        if not finals or finals[-1].result != "passed":
            raise HTTPException(400, "final 检查还没通过，不能确认这道门" + ("（最近一次没过）" if finals else "（还没有标 final 的检查记录）"))
    if confirm:
        # 大节点：以 D 或 J 的身份确认。当前身份是 D/J 就用自己，负责人代勾要指明替谁勾
        as_who = body.confirm_as or (actor if actor in confirm else None)
        if as_who not in confirm:
            raise HTTPException(400, f"大节点要由 {' 和 '.join(confirm)} 确认，请选择以谁的身份勾")
        if as_who != actor and not allowed(actor, "confirm_for_others"):
            raise HTTPException(403, f"{actor} 不能替 {as_who} 确认大节点")
        store_key = f"{key}:{as_who}"
        who_label = as_who if as_who == actor else f"{as_who}（{actor} 代勾）"
    else:
        from ..message_codes import system_error
        raise system_error(409, "server.evidenceReviewRequired")
    rec = db.scalar(select(models.ProjectStep).where(models.ProjectStep.project_id == project_id, models.ProjectStep.key == store_key))
    if rec is None:
        rec = models.ProjectStep(project_id=project_id, key=store_key)
        db.add(rec)
    if rec.done == body.done and rec.note == body.note:
        return compute_steps(db,p,hide_money=not can_read_money(actor))
    task=db.scalar(select(models.Task).where(models.Task.project_id==project_id,models.Task.step_key==key))
    before_done=next(i['done'] for st in compute_steps(db,p)['stages'] for i in st['items'] if i['key']==key)
    if task:
        from ..task_activity import utc_now
        expected=body.version if body.version is not None else task.version
        claimed=db.execute(update(models.Task).where(models.Task.id==task.id,models.Task.version==expected).values(version=expected+1,updated_at=utc_now()).execution_options(synchronize_session=False))
        if not claimed.rowcount:
            db.rollback()
            from ..message_codes import system_error
            raise system_error(409,'server.evidenceReviewConflict')
        db.expire(task)
    before_rec_done=rec.done
    rec.done = body.done
    rec.done_by = who_label if body.done else None
    from ..task_activity import utc_now
    rec.done_at = utc_now() if body.done else None
    rec.note = body.note
    if confirm:
        as_who = store_key.split(":")[1]
        head = ("替 " + as_who + " 确认了" if as_who != actor else "确认了") if body.done else ("取消了替 " + as_who + " 的确认：" if as_who != actor else "取消了确认：")
        text = f"{head}“{ITEM_TITLE[key]}”" if body.done else f"{head}“{ITEM_TITLE[key]}”"
    else:
        text = f"{'完成了' if body.done else '取消了'}“{ITEM_TITLE[key]}”"
    log_update(db, project_id, actor, "step", text + (f"：{body.note}" if body.note else ""))
    if key == "open_escrow" and body.done:
        _freeze_lead_substage(db, p, request, actor)
    db.flush()
    after_done=next(i['done'] for st in compute_steps(db,p)['stages'] for i in st['items'] if i['key']==key)
    if task and after_done!=before_done:
        u=current_user(request,db)
        at=utc_now()
        if after_done:
            task.gate_confirmation_json=json.dumps({'user_id':u.id if u else None,'name':u.display_name if u else actor,'role':actor,'at':at,'confirmed':confirm,'facts':{'node_key':key}},ensure_ascii=False)
            task.done_at=at
        db.add(models.TaskEvent(task_id=task.id,project_id=project_id,kind='node_confirmed' if after_done else 'node_reopened',actor_user_id=u.id if u else None,actor_role_snapshot=actor,before_json=json.dumps({'done':before_done}),after_json=json.dumps({'done':after_done,'name':u.display_name if u else actor,'node_key':key}),created_at=at))
    elif task and before_rec_done!=body.done:
        u=current_user(request,db)
        db.add(models.TaskEvent(task_id=task.id,project_id=project_id,kind='node_partial_confirmed',actor_user_id=u.id if u else None,actor_role_snapshot=actor,after_json=json.dumps({'node_key':key,'confirm_as':store_key.split(':')[-1],'done':body.done}),created_at=utc_now()))
    commit_evidence(db, project_id, evidence_before, actor)
    return compute_steps(db, p, hide_money=not can_read_money(actor))


_LEAD_SUB_LABEL = {s["value"]: s["label"] for s in SUBSTAGES["lead"]}


def _freeze_lead_substage(db: Session, p: models.Project, request: Request, actor: str) -> None:
    """open_escrow 的 D、J 都确认了：把此刻的人工跟进档位存一份快照并记事件（KAN-75 块 2，配合 KAN-74）。

    写在确认那一次，不写在 GET 路径；substage 列本身随后仍会被 sync_legacy_stage 覆盖，这里不拦它。
    只记第一次；已有快照不覆盖。
    """
    db.flush()  # 应用的 Session 关了 autoflush：刚 add 的那条确认要先 flush，下面的查询才看得到
    recs = db.scalars(select(models.ProjectStep).where(models.ProjectStep.project_id == p.id,
                                                       models.ProjectStep.key.in_(["open_escrow:D", "open_escrow:J"]))).all()
    if len([r for r in recs if r.done]) < 2 or p.lead_substage_at_escrow is not None:
        return
    snap = p.substage if p.stage == "lead" and p.substage else "new_lead"
    p.lead_substage_at_escrow = snap
    u = current_user(request, db)
    db.add(models.TaskEvent(task_id=None, project_id=p.id, kind="lead_substage_frozen",
                            actor_user_id=u.id if u else None, actor_role_snapshot=actor,
                            after_json=json.dumps({"substage": snap, "label": _LEAD_SUB_LABEL.get(snap, snap)}, ensure_ascii=False)))
    log_update(db, p.id, actor, "project", f"Open escrow 双确认成立，过门前档位记为「{_LEAD_SUB_LABEL.get(snap, snap)}」")


def _with_names(db: Session, rows: list[models.ProjectUpdate], actor: str = "负责人") -> list[schemas.UpdateOut]:
    names = {p.id: p.name for p in db.scalars(select(models.Project).where(models.Project.id.in_({r.project_id for r in rows}))).all()}
    users = {u.id: u.display_name for u in db.scalars(select(models.User).where(models.User.id.in_({r.actor_user_id for r in rows if r.actor_user_id is not None}))).all()}
    hide = not can_read_money(actor)
    return [schemas.UpdateOut(id=r.id, project_id=r.project_id, project_name=names.get(r.project_id), actor=r.actor, actor_user_id=r.actor_user_id, actor_name=users.get(r.actor_user_id), changes=json.loads(r.changes_json) if r.changes_json else None, kind=r.kind,
                              text=(MONEY_RE.sub("$***", r.text) if hide and r.kind != "project_company" else r.text), created_at=r.created_at) for r in rows]


@router.get("/updates", response_model=list[schemas.UpdateOut])
def all_updates(request: Request, limit: int = 30, actor: Optional[str] = None, db: Session = Depends(get_db), me: str = Depends(get_actor)):
    stmt = select(models.ProjectUpdate).where(models.ProjectUpdate.project_id.in_(visible_project_ids(db, current_user(request, db)))).order_by(models.ProjectUpdate.created_at.desc(), models.ProjectUpdate.id.desc()).limit(limit)
    if actor:
        stmt = stmt.where(models.ProjectUpdate.actor == actor)
    return _with_names(db, db.scalars(stmt).all(), me)


@router.get("/projects/{project_id}/updates", response_model=list[schemas.UpdateOut])
def project_updates(project_id: int, request: Request, limit: int = 30, db: Session = Depends(get_db), me: str = Depends(get_actor)):
    require_project_read(db, project_id, current_user(request, db))
    _project(db, project_id)
    stmt = (select(models.ProjectUpdate).where(models.ProjectUpdate.project_id == project_id)
            .order_by(models.ProjectUpdate.created_at.desc(), models.ProjectUpdate.id.desc()).limit(limit))
    return _with_names(db, db.scalars(stmt).all(), me)
