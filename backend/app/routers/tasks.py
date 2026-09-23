"""任务实例：每套房每个普通清单项一条，分派给具体账号（KAN-75 块 1）。

- 只对 STAGE_CHECKLIST 里 gate=False 的 24 项建实例；7 个关键节点仍走 project_steps 的 D/J 确认，不在这里。
- 执行状态（未开始 / 进行中 / 等待 / 待确认 / 已完成）只描述人在做什么；「满足」仍由 steps.compute_steps 按证据派生，
  两者并列返回，界面并列显示，谁也不替代谁。分派层没有「完成」按钮。
- 所有写接口要求真登录（require_user）；演示模式的 X-Actor 头对写接口无效。
- 事件与业务写同一事务；GET 不写任何东西。ensure_tasks 不在 GET 里调（同 ensure_procurement）。
"""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..dictionaries import STAGE_CHECKLIST, STEP_BY_KEY, TASK_EVENT_KINDS, TASK_EXEC_STATUSES
from ..models import now_iso
from ..steps import compute_steps
from .common import allowed, can_read_money, get_actor, log_update, require, require_user

router = APIRouter(prefix="/api", tags=["tasks"])

STAGE_INDEX = {st["key"]: i + 1 for i, st in enumerate(STAGE_CHECKLIST)}
STAGE_LABEL = {st["key"]: st["label"] for st in STAGE_CHECKLIST}
STAGE_SHORT = {st["key"]: st.get("short", st["label"]) for st in STAGE_CHECKLIST}
STATUS_LABEL = {s["value"]: s["label"] for s in TASK_EXEC_STATUSES}
ORDINARY_ITEMS = [(st["key"], it) for st in STAGE_CHECKLIST for it in st["items"] if not it.get("gate")]


# ---------------- 预建与成员 ----------------

def ensure_tasks(db: Session, project_id: int) -> list[models.Task]:
    """按模板给这套房建普通任务实例（建项目 / seed / 启动回填用）；已有的不动。幂等靠 (project_id, step_key) 唯一。"""
    rows = list(db.scalars(select(models.Task).where(models.Task.project_id == project_id)).all())
    have = {t.step_key for t in rows if t.step_key}
    added = False
    for stage_key, it in ORDINARY_ITEMS:
        if it["key"] in have:
            continue
        db.add(models.Task(project_id=project_id, step_key=it["key"], source="template", stage_key=stage_key, title=it["title"]))
        added = True
    if added:
        db.commit()
        rows = list(db.scalars(select(models.Task).where(models.Task.project_id == project_id)).all())
    return rows


def ensure_member(db: Session, project_id: int, user: models.User, by: Optional[models.User]) -> bool:
    """把账号加进项目成员；已在则返回 False。调用方负责 commit 与事件。"""
    rec = db.scalar(select(models.ProjectMember).where(models.ProjectMember.project_id == project_id, models.ProjectMember.user_id == user.id))
    if rec:
        if not rec.active:
            rec.active = True
            return True
        return False
    db.add(models.ProjectMember(project_id=project_id, user_id=user.id, role_snapshot=user.role_code,
                                added_by_user_id=by.id if by else None))
    return True


def _members(db: Session, project_id: int) -> list[models.ProjectMember]:
    return list(db.scalars(select(models.ProjectMember).where(models.ProjectMember.project_id == project_id, models.ProjectMember.active.is_(True))).all())


# ---------------- 序列化 ----------------

def _brief(u: Optional[models.User]) -> Optional[dict]:
    if u is None:
        return None
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "role_code": u.role_code, "active": u.active}


def _event_text(ev: models.TaskEvent, names: dict[int, str]) -> str:
    before = json.loads(ev.before_json) if ev.before_json else {}
    after = json.loads(ev.after_json) if ev.after_json else {}
    who = lambda uid: names.get(uid, f"账号 {uid}") if uid is not None else "待分派"  # noqa: E731
    k = ev.kind
    if k == "assigned":
        t = f"分派给 {who(after.get('assignee_user_id'))}"
    elif k == "reassigned":
        t = f"从 {who(before.get('assignee_user_id'))} 改派给 {who(after.get('assignee_user_id'))}"
    elif k == "unassigned":
        t = f"取消了 {who(before.get('assignee_user_id'))} 的分派"
    elif k == "rescheduled":
        t = f"截止日期 {before.get('due_at') or '未设定'} → {after.get('due_at') or '未设定'}"
    elif k == "started":
        t = "开始处理"
    elif k == "waiting":
        t = "记录等待" + (f"：等 {after.get('wait_for')}" if after.get("wait_for") else "") + (f"，预计 {after.get('wait_until')} 回复" if after.get("wait_until") else "")
    elif k == "resumed":
        t = "恢复处理"
    elif k == "member_added":
        t = f"{who(after.get('user_id'))} 加入了项目"
    else:
        t = TASK_EVENT_KINDS.get(k, k)
    if ev.reason:
        t += f"：{ev.reason}"
    return t


def _event_out(ev: models.TaskEvent, users: dict[int, models.User]) -> dict:
    names = {uid: u.display_name for uid, u in users.items()}
    return {
        "id": ev.id, "task_id": ev.task_id, "project_id": ev.project_id, "kind": ev.kind,
        "kind_label": TASK_EVENT_KINDS.get(ev.kind, ev.kind),
        "actor": _brief(users.get(ev.actor_user_id)) if ev.actor_user_id else None,
        "actor_role_snapshot": ev.actor_role_snapshot,
        "before": json.loads(ev.before_json) if ev.before_json else None,
        "after": json.loads(ev.after_json) if ev.after_json else None,
        "reason": ev.reason, "created_at": ev.created_at, "text": _event_text(ev, names),
    }


def _users_by_id(db: Session, ids: set[int]) -> dict[int, models.User]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {u.id: u for u in db.scalars(select(models.User).where(models.User.id.in_(ids))).all()}


def _task_out(t: models.Task, p: models.Project, steps: dict, users: dict[int, models.User], last: Optional[models.TaskEvent]) -> dict:
    it = STEP_BY_KEY.get(t.step_key or "", {})
    step_item = None
    for st in steps["stages"]:
        for si in st["items"]:
            if si["key"] == t.step_key:
                step_item = si
                break
    cur = steps["current_stage"]
    cur_idx = len(STAGE_CHECKLIST) + 1 if cur["key"] == "done" else STAGE_INDEX.get(cur["key"], 1)
    return {
        "id": t.id, "project_id": t.project_id, "project_name": p.name, "project_address": p.property.address_std,
        "step_key": t.step_key, "source": t.source,
        "stage_key": t.stage_key, "stage_label": STAGE_LABEL.get(t.stage_key, t.stage_key), "stage_short": STAGE_SHORT.get(t.stage_key, t.stage_key),
        "stage_index": STAGE_INDEX.get(t.stage_key, 0), "project_current_stage_index": cur_idx, "project_current_stage_label": cur["label"],
        "title": t.title, "ws": it.get("ws"), "purpose": it.get("purpose"), "done_when": it.get("done_when"),
        "owners": it.get("owners", []), "deliverable": it.get("deliverable"),
        "description": t.description, "deliverable_note": t.deliverable_note,
        "assignee": _brief(users.get(t.assignee_user_id)) if t.assignee_user_id else None,
        "reviewer": _brief(users.get(t.reviewer_user_id)) if t.reviewer_user_id else None,
        "exec_status": t.exec_status, "exec_status_label": STATUS_LABEL.get(t.exec_status, t.exec_status),
        "due_at": t.due_at, "wait_for": t.wait_for, "wait_reason": t.wait_reason, "wait_until": t.wait_until,
        "version": t.version,
        "satisfied": bool(step_item and step_item["done"]), "satisfied_how": (step_item or {}).get("how"),
        "satisfied_evidence": (step_item or {}).get("evidence"), "evidence_hint": (step_item or {}).get("evidence_hint"),
        "last_event": _event_out(last, users) if last else None,
        "created_at": t.created_at, "updated_at": t.updated_at,
    }


def _project(db: Session, project_id: int) -> models.Project:
    p = db.get(models.Project, project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p


def _task(db: Session, project_id: int, task_id: int) -> models.Task:
    t = db.get(models.Task, task_id)
    if not t or t.project_id != project_id:
        raise HTTPException(404, "任务不存在")
    return t


def _last_events(db: Session, task_ids: list[int]) -> dict[int, models.TaskEvent]:
    if not task_ids:
        return {}
    out: dict[int, models.TaskEvent] = {}
    for ev in db.scalars(select(models.TaskEvent).where(models.TaskEvent.task_id.in_(task_ids)).order_by(models.TaskEvent.created_at.desc(), models.TaskEvent.id.desc())).all():
        out.setdefault(ev.task_id, ev)
    return out


def _tasks_payload(db: Session, p: models.Project, tasks: list[models.Task], actor: str) -> list[dict]:
    steps = compute_steps(db, p, hide_money=not can_read_money(actor))
    ids = {t.assignee_user_id for t in tasks} | {t.reviewer_user_id for t in tasks}
    last = _last_events(db, [t.id for t in tasks])
    ids |= {ev.actor_user_id for ev in last.values()}
    users = _users_by_id(db, ids)
    order = {it["key"]: i for i, (_, it) in enumerate(ORDINARY_ITEMS)}
    tasks = sorted(tasks, key=lambda t: (order.get(t.step_key, 999), t.id))
    return [_task_out(t, p, steps, users, last.get(t.id)) for t in tasks]


def _event(db: Session, task: Optional[models.Task], project_id: int, kind: str, actor: models.User,
           before: Optional[dict] = None, after: Optional[dict] = None, reason: Optional[str] = None) -> models.TaskEvent:
    ev = models.TaskEvent(task_id=task.id if task else None, project_id=project_id, kind=kind,
                          actor_user_id=actor.id, actor_role_snapshot=actor.role_code,
                          before_json=json.dumps(before, ensure_ascii=False) if before else None,
                          after_json=json.dumps(after, ensure_ascii=False) if after else None,
                          reason=reason or None)
    db.add(ev)
    return ev


def _conflict(db: Session, p: models.Project, t: models.Task, actor: str):
    """版本不对：把最新的任务一起返回，前端刷新后再提交，不覆盖别人的改动。"""
    payload = _tasks_payload(db, p, [t], actor)[0]
    raise HTTPException(409, {"message": "这项任务刚被别人改过，已刷新为最新安排，请再确认一次", "task": payload})


# ---------------- 读 ----------------

@router.get("/projects/{project_id}/tasks", response_model=schemas.TaskListOut)
def list_tasks(project_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    p = _project(db, project_id)
    tasks = list(db.scalars(select(models.Task).where(models.Task.project_id == project_id)).all())
    steps_stages = [{"key": st["key"], "label": st["label"], "short": st.get("short", st["label"]), "index": i + 1} for i, st in enumerate(STAGE_CHECKLIST)]
    payload = _tasks_payload(db, p, tasks, actor)
    cur = payload[0]["project_current_stage_index"] if payload else 1
    return {"tasks": payload, "stages": steps_stages, "current_stage_index": cur,
            "template_missing": not tasks, "can_assign": allowed(actor, "assign_tasks")}


@router.get("/projects/{project_id}/members", response_model=schemas.MembersOut)
def list_members(project_id: int, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    _project(db, project_id)
    members = _members(db, project_id)
    users = _users_by_id(db, {m.user_id for m in members})
    member_ids = set(users)
    rows = [{**_brief(users[m.user_id]), "role_snapshot": m.role_snapshot, "added_at": m.added_at} for m in members if m.user_id in users and users[m.user_id].active]
    others = [_brief(u) for u in db.scalars(select(models.User).where(models.User.active.is_(True)).order_by(models.User.role_code, models.User.id)).all() if u.id not in member_ids]
    can = allowed(me.role_code, "assign_tasks")
    return {"members": rows, "others": others, "can_assign": can, "can_add_member": can}


@router.get("/projects/{project_id}/tasks/{task_id}/events", response_model=list[schemas.TaskEventOut])
def task_events(project_id: int, task_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    _project(db, project_id)
    t = _task(db, project_id, task_id)
    evs = list(db.scalars(select(models.TaskEvent).where(models.TaskEvent.task_id == t.id).order_by(models.TaskEvent.created_at.desc(), models.TaskEvent.id.desc())).all())
    ids = {e.actor_user_id for e in evs}
    for e in evs:
        for blob in (e.before_json, e.after_json):
            if blob:
                d = json.loads(blob)
                ids |= {d.get("assignee_user_id"), d.get("user_id"), d.get("reviewer_user_id")}
    users = _users_by_id(db, ids)
    return [_event_out(e, users) for e in evs]


@router.get("/me/tasks", response_model=schemas.MyTasksOut)
def my_tasks(db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    """分派给我的 + 我是审核人的，按项目算满足与当前段。只按 user_id，不按角色。"""
    tasks = list(db.scalars(select(models.Task).where((models.Task.assignee_user_id == me.id) | (models.Task.reviewer_user_id == me.id))).all())
    by_project: dict[int, list[models.Task]] = {}
    for t in tasks:
        by_project.setdefault(t.project_id, []).append(t)
    out: list[dict] = []
    for pid, rows in by_project.items():
        p = db.get(models.Project, pid)
        if p is None:
            continue
        out.extend(_tasks_payload(db, p, rows, me.role_code))
    out.sort(key=lambda r: (r["project_current_stage_index"] < r["stage_index"], r["project_name"], r["stage_index"]))
    return {"assigned": [r for r in out if r["assignee"] and r["assignee"]["id"] == me.id],
            "reviewing": [r for r in out if r["reviewer"] and r["reviewer"]["id"] == me.id and not (r["assignee"] and r["assignee"]["id"] == me.id)]}


# ---------------- 写 ----------------

@router.post("/projects/{project_id}/tasks/{task_id}/assign", response_model=schemas.TaskOut)
def assign_task(project_id: int, task_id: int, body: schemas.TaskAssignIn, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    """分派 / 改派 / 改截止。改派要写原因；不是成员的账号要显式 join_project。保存成功后各入口才更新。"""
    require(me.role_code, "assign_tasks", what="分派任务")
    p = _project(db, project_id)
    t = _task(db, project_id, task_id)
    if t.version != body.version:
        _conflict(db, p, t, me.role_code)
    data = body.model_dump(exclude_unset=True)
    prev_assignee = t.assignee_user_id
    new_assignee = prev_assignee
    target: Optional[models.User] = None
    if "assignee_user_id" in data:
        new_assignee = body.assignee_user_id
        if new_assignee is not None:
            target = db.get(models.User, new_assignee)
            if target is None or not target.active:
                raise HTTPException(400, "这个账号不存在或已停用，不能分派")
            is_member = any(m.user_id == target.id for m in _members(db, project_id))
            if not is_member:
                if not body.join_project:
                    raise HTTPException(400, f"{target.display_name} 还不是本项目成员。要分派给他，请选择「加入项目并分派」")
                if ensure_member(db, project_id, target, me):
                    db.flush()
                    _event(db, t, project_id, "member_added", me, after={"user_id": target.id, "role_code": target.role_code})
    changed_assignee = new_assignee != prev_assignee
    if changed_assignee and prev_assignee is not None and not (body.reason or "").strip():
        raise HTTPException(400, "改派或取消分派要写原因，让接手的人和原负责人都看得到")
    if "due_at" in data and (body.due_at or None) != (t.due_at or None):
        before_due = t.due_at
        t.due_at = body.due_at or None
        _event(db, t, project_id, "rescheduled", me, before={"due_at": before_due}, after={"due_at": t.due_at}, reason=body.reason if not changed_assignee else None)
        if not changed_assignee:
            log_update(db, project_id, me.role_code, "task", f"改了“{t.title}”的截止日期：{t.due_at or '未设定'}")
    if changed_assignee:
        before = {"assignee_user_id": prev_assignee, "exec_status": t.exec_status}
        t.assignee_user_id = new_assignee
        if prev_assignee is not None:
            # 换人后执行状态回到未开始：原负责人的开始 / 等待属于他自己，不能算在新负责人头上；历史仍在事件里。
            t.exec_status = "not_started"
            t.wait_for = t.wait_reason = t.wait_until = None
        if new_assignee is not None and t.reviewer_user_id is None:
            t.reviewer_user_id = me.id  # 审核人为空时默认是分派的人（待 Ryan 最终确认，可改）
        kind = "assigned" if prev_assignee is None else ("unassigned" if new_assignee is None else "reassigned")
        _event(db, t, project_id, kind, me, before=before,
               after={"assignee_user_id": new_assignee, "reviewer_user_id": t.reviewer_user_id, "exec_status": t.exec_status}, reason=body.reason)
        who = target.display_name if target else "待分派"
        log_update(db, project_id, me.role_code, "task", f"{'分派' if kind == 'assigned' else '改派' if kind == 'reassigned' else '取消分派'}“{t.title}”：{who}")
    t.version += 1
    t.updated_at = now_iso()
    db.commit()
    db.refresh(t)
    return _tasks_payload(db, p, [t], me.role_code)[0]


_TRANSITIONS = {
    "start": ({"not_started"}, "in_progress", "started"),
    "wait": ({"not_started", "in_progress"}, "waiting", "waiting"),
    "resume": ({"waiting"}, "in_progress", "resumed"),
}


@router.post("/projects/{project_id}/tasks/{task_id}/status", response_model=schemas.TaskOut)
def task_status(project_id: int, task_id: int, body: schemas.TaskStatusIn, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    """开始 / 记录等待 / 恢复。只有当前负责人能做；改派后旧负责人 403。没有「完成」——完成由审核确认（块 5）。"""
    p = _project(db, project_id)
    t = _task(db, project_id, task_id)
    if t.assignee_user_id != me.id:
        owner = db.get(models.User, t.assignee_user_id) if t.assignee_user_id else None
        raise HTTPException(403, f"这项任务现在由 {owner.display_name if owner else '待分派'} 负责，你不能改它的进度")
    if body.action not in _TRANSITIONS:
        raise HTTPException(400, "未知动作")
    if t.version != body.version:
        _conflict(db, p, t, me.role_code)
    allowed_from, to, kind = _TRANSITIONS[body.action]
    if t.exec_status not in allowed_from:
        raise HTTPException(400, f"现在是「{STATUS_LABEL.get(t.exec_status, t.exec_status)}」，不能{ {'start': '开始', 'wait': '记录等待', 'resume': '恢复'}[body.action] }")
    before = {"exec_status": t.exec_status, "wait_for": t.wait_for, "wait_reason": t.wait_reason, "wait_until": t.wait_until}
    if body.action == "wait":
        if not (body.wait_reason or "").strip():
            raise HTTPException(400, "记录等待要写原因：在等谁、等什么")
        t.wait_for = (body.wait_for or "").strip() or None
        t.wait_reason = body.wait_reason.strip()
        t.wait_until = (body.wait_until or "").strip() or None
    else:
        t.wait_for = t.wait_reason = t.wait_until = None
    t.exec_status = to
    after = {"exec_status": t.exec_status, "wait_for": t.wait_for, "wait_reason": t.wait_reason, "wait_until": t.wait_until}
    _event(db, t, project_id, kind, me, before=before, after=after, reason=body.wait_reason if body.action == "wait" else None)
    log_update(db, project_id, me.role_code, "task", f"{TASK_EVENT_KINDS[kind]}“{t.title}”" + (f"：{t.wait_reason}" if body.action == "wait" else ""))
    t.version += 1
    t.updated_at = now_iso()
    db.commit()
    db.refresh(t)
    return _tasks_payload(db, p, [t], me.role_code)[0]
