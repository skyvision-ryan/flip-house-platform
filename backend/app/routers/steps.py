"""阶段清单与更新记录。"""

import json
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..auth import current_user
from ..dictionaries import ITEM_EVIDENCE, STAGE_CHECKLIST, SUBSTAGES
from ..steps import compute_steps
from .common import allowed, can_read_money, get_actor, log_update

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
    p = _project(db, project_id)
    if key not in ITEM_TITLE:
        raise HTTPException(400, "未知清单项")
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
        if ITEM_EVIDENCE.get(key, "manual") != "manual":
            # 有自动证据的项：只有紫蓝能手工确认（记成“无证据”），执行角色要交东西
            if not allowed(actor, "tick_any"):
                raise HTTPException(400, f"“{ITEM_TITLE[key]}”要交东西才算完成，不能手工勾")
            who_label = f"{actor}（手工确认，无证据）"
        elif actor not in ITEM_OWNERS[key] and not allowed(actor, "tick_any"):
            raise HTTPException(403, f"“{ITEM_TITLE[key]}”由 {'、'.join(ITEM_OWNERS[key])} 负责，{actor} 不能勾")
        elif actor not in ITEM_OWNERS[key]:
            who_label = f"{actor}（代勾）"
    rec = db.scalar(select(models.ProjectStep).where(models.ProjectStep.project_id == project_id, models.ProjectStep.key == store_key))
    if rec is None:
        rec = models.ProjectStep(project_id=project_id, key=store_key)
        db.add(rec)
    rec.done = body.done
    rec.done_by = who_label if body.done else None
    rec.done_at = datetime.now().isoformat(timespec="seconds") if body.done else None
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
    db.commit()
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
    names = {p.id: p.name for p in db.scalars(select(models.Project)).all()}
    hide = not can_read_money(actor)
    return [schemas.UpdateOut(id=r.id, project_id=r.project_id, project_name=names.get(r.project_id), actor=r.actor, kind=r.kind,
                              text=(MONEY_RE.sub("$***", r.text) if hide else r.text), created_at=r.created_at) for r in rows]


@router.get("/updates", response_model=list[schemas.UpdateOut])
def all_updates(limit: int = 30, actor: Optional[str] = None, db: Session = Depends(get_db), me: str = Depends(get_actor)):
    stmt = select(models.ProjectUpdate).order_by(models.ProjectUpdate.created_at.desc(), models.ProjectUpdate.id.desc()).limit(limit)
    if actor:
        stmt = stmt.where(models.ProjectUpdate.actor == actor)
    return _with_names(db, db.scalars(stmt).all(), me)


@router.get("/projects/{project_id}/updates", response_model=list[schemas.UpdateOut])
def project_updates(project_id: int, limit: int = 30, db: Session = Depends(get_db), me: str = Depends(get_actor)):
    _project(db, project_id)
    stmt = (select(models.ProjectUpdate).where(models.ProjectUpdate.project_id == project_id)
            .order_by(models.ProjectUpdate.created_at.desc(), models.ProjectUpdate.id.desc()).limit(limit))
    return _with_names(db, db.scalars(stmt).all(), me)
