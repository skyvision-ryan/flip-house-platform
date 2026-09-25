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

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from .. import models, schemas
from ..auth import current_user
from ..db import get_db
from ..dictionaries import STAGE_CHECKLIST, STEP_BY_KEY, TASK_EVENT_KINDS, TASK_EXEC_STATUSES
from ..models import now_iso
from ..steps import compute_steps
from .common import allowed, can_read_money, get_actor, log_update, require, require_user
from .files import _can_download

router = APIRouter(prefix="/api", tags=["tasks"])

STAGE_INDEX = {st["key"]: i + 1 for i, st in enumerate(STAGE_CHECKLIST)}
STAGE_LABEL = {st["key"]: st["label"] for st in STAGE_CHECKLIST}
STAGE_SHORT = {st["key"]: st.get("short", st["label"]) for st in STAGE_CHECKLIST}
STATUS_LABEL = {s["value"]: s["label"] for s in TASK_EXEC_STATUSES}
DECISION_LABEL = {"pending": "待确认", "confirmed": "已确认", "returned": "已退回"}
FILE_KINDS = {"file", "photo"}   # 这两类交付物提交时至少要一个文件；其余交说明即可
ORDINARY_ITEMS = [(st["key"], it) for st in STAGE_CHECKLIST for it in st["items"] if not it.get("gate")]


# ---------------- 预建与成员 ----------------

def ensure_tasks(db: Session, project_id: int, *, commit: bool = True) -> list[models.Task]:
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
        db.commit() if commit else db.flush()
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
    elif k == "submitted":
        t = f"第 {after.get('seq')} 次提交" + (f"，{after.get('files')} 个文件" if after.get("files") else "，只交了说明")
    elif k == "returned":
        t = f"退回第 {after.get('seq')} 次提交"
    elif k == "confirmed":
        t = f"确认第 {after.get('seq')} 次交付，任务完成"
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


def _submissions(db: Session, task_ids: list[int]) -> dict[int, list[models.TaskSubmission]]:
    if not task_ids:
        return {}
    out: dict[int, list[models.TaskSubmission]] = {}
    for sub in db.scalars(select(models.TaskSubmission).where(models.TaskSubmission.task_id.in_(task_ids)).order_by(models.TaskSubmission.seq.desc(), models.TaskSubmission.id.desc())).all():
        out.setdefault(sub.task_id, []).append(sub)
    return out


def _submission_out(db: Session, sub: models.TaskSubmission, users: dict[int, models.User]) -> dict:
    links = db.scalars(select(models.SubmissionFile).where(models.SubmissionFile.submission_id == sub.id)).all()
    files = []
    for l in links:
        f = db.get(models.ProjectFile, l.file_id)
        if f:
            files.append({"id": f.id, "filename": f.filename, "mime": f.mime, "size": f.size, "doc_type": f.doc_type, "uploaded_at": f.uploaded_at})
    return {"id": sub.id, "task_id": sub.task_id, "seq": sub.seq, "note": sub.note,
            "submitted_by": _brief(users.get(sub.submitted_by_user_id)) if sub.submitted_by_user_id else None, "submitted_at": sub.submitted_at,
            "decision": sub.decision, "decision_label": DECISION_LABEL.get(sub.decision, sub.decision),
            "decided_by": _brief(users.get(sub.decided_by_user_id)) if sub.decided_by_user_id else None, "decided_at": sub.decided_at,
            "decision_reason": sub.decision_reason, "files": files}


def _task_out(t: models.Task, p: models.Project, steps: dict, users: dict[int, models.User], last: Optional[models.TaskEvent], subs: Optional[list[dict]] = None) -> dict:
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
        "done_at": t.done_at, "requires_file": (it.get("deliverable") or {}).get("kind") in FILE_KINDS,
        "submissions": subs or [],
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


def _require_task_read(db: Session, project_id: int, me: Optional[models.User]) -> None:
    # get_actor has already rejected formal-mode guests. Preserve DEMO_MODE guest previews,
    # but a signed account's scope always comes from its actual role and active membership.
    if me is None or allowed(me.role_code, "workbench_all_projects"):
        return
    member = db.scalar(select(models.ProjectMember.id).where(
        models.ProjectMember.project_id == project_id,
        models.ProjectMember.user_id == me.id,
        models.ProjectMember.active.is_(True)))
    if member is None:
        raise HTTPException(403, "你不是本项目的有效成员，不能查看任务或成员信息")


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
    subs = _submissions(db, [t.id for t in tasks])
    for lst in subs.values():
        ids |= {x.submitted_by_user_id for x in lst} | {x.decided_by_user_id for x in lst}
    users = _users_by_id(db, ids)
    order = {it["key"]: i for i, (_, it) in enumerate(ORDINARY_ITEMS)}
    tasks = sorted(tasks, key=lambda t: (order.get(t.step_key, 999), t.id))
    return [_task_out(t, p, steps, users, last.get(t.id), [_submission_out(db, x, users) for x in subs.get(t.id, [])]) for t in tasks]


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


def _commit_task(db: Session, p: models.Project, t: models.Task, actor: str) -> None:
    """Commit task, submission and history together, or discard the entire losing transaction."""
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        db.refresh(t)
        _conflict(db, p, t, actor)


# ---------------- 头卡三条事实（按分组动态） ----------------

def _gate(steps: dict, key: str) -> Optional[dict]:
    for st in steps["stages"]:
        for it in st["items"]:
            if it["key"] == key:
                return it
    return None


def _gate_text(g: Optional[dict]) -> str:
    if not g:
        return "—"
    if g["done"]:
        return "已过" + (f"（{g['done_at'][5:10].replace('-', '/')}）" if g.get("done_at") else "")
    if g["confirm"]:
        missing = [c for c in g["confirm"] if c not in g["confirmed"]]
        return f"{'、'.join(g['confirmed'])} 已确认，等 {'、'.join(missing)}" if g["confirmed"] else f"待 {'、'.join(g['confirm'])} 确认"
    return "尚未满足"


def _mmdd(v: Optional[str]) -> str:
    return v[5:10].replace("-", "/") if v else "未填"


def focus_facts(p: models.Project, steps: dict, rows: list[dict]) -> list[dict]:
    """项目头卡右侧三条事实。只陈述已有数据：任务表、项目日期、关键节点；没有的写「未填」，不推导。"""
    gp = steps["group_position"]
    cur_key = steps["current_stage"]["key"]
    cur = [r for r in rows if r["stage_key"] == cur_key]
    waiting = [r for r in rows if r["exec_status"] == "waiting"]
    unassigned = [r for r in cur if not r["assignee"] and r["exec_status"] != "done"]
    pending = [r for r in rows if r["exec_status"] == "pending_review"]
    running = sorted([r for r in cur if r["exec_status"] == "in_progress"], key=lambda r: r["due_at"] or "9999")
    unsatisfied = [r for r in cur if not r["satisfied"] and r["exec_status"] != "done"]
    nxt = next_action(rows, cur_key)

    def fact(label, value, tone="normal"):
        return {"label": label, "value": value, "tone": tone}

    g, sub = gp["group_key"], gp["sub_key"]
    if g == "buying" and sub == "pre":
        return [fact("下一动作", nxt["title"] if nxt else "本段任务都已安排"),
                fact("跟进档位", gp["lead_substage_label"] or "未填"),
                fact("待安排", f"{len(unassigned)} 项", "warning" if unassigned else "normal")]
    if g == "buying":
        return [fact("目标过户", _mmdd(p.purchase_date)),
                fact("Close escrow", _gate_text(_gate(steps, "close_escrow"))),
                fact("当前待协调", f"{len(waiting)} 项", "warning" if waiting else "normal")]
    if g == "renovation":
        focus = pending[0]["title"] + " 待审核" if pending else (running[0]["title"] + " 进行中" if running else (nxt["title"] if nxt else "本段任务都已安排"))
        return [fact("当前重点", focus),
                fact("计划开工", _mmdd(p.construction_start)),
                fact("待协调", f"{len(waiting)} 项等待", "warning" if waiting else "normal")]
    if g == "prelisting":
        return [fact("City Final", _gate_text(_gate(steps, "final"))),
                fact("计划挂牌", _mmdd(p.list_date)),
                fact("待补资料", f"{len(unsatisfied)} 项", "warning" if unsatisfied else "normal")]
    if g == "selling":
        return [fact("挂牌日期", _mmdd(p.list_date)),
                fact("收到 Offer", _gate_text(_gate(steps, "offer"))),
                fact("目标交割", _mmdd(p.sale_date))]
    dues = sorted([r["due_at"] for r in cur if r["due_at"]])
    return [fact("交割确认", _gate_text(_gate(steps, "closed"))),
            fact("收尾截止", _mmdd(dues[-1]) if dues else "未设定"),
            fact("待核对", f"{len(unsatisfied)} 项", "warning" if unsatisfied else "normal")]


def next_action(rows: list[dict], cur_key: str) -> Optional[dict]:
    """这套房现在最该动的一项：待审核（任何段，等人确认就是最要紧的）> 当前段进行中（最早截止）> 已分派未开始 > 等待 > 待分派。"""
    by_due = lambda r: (r["due_at"] or "9999", r["id"])  # noqa: E731
    pending = sorted([r for r in rows if r["exec_status"] == "pending_review"], key=by_due)
    if pending:
        return pending[0]
    cur = [r for r in rows if r["stage_key"] == cur_key and r["exec_status"] != "done"]
    for pick in (
        lambda r: r["exec_status"] == "in_progress",
        lambda r: r["exec_status"] == "not_started" and r["assignee"],
        lambda r: r["exec_status"] == "waiting",
        lambda r: not r["assignee"],
    ):
        hit = sorted([r for r in cur if pick(r)], key=by_due)
        if hit:
            return hit[0]
    return None


# ---------------- 读 ----------------

@router.get("/projects/{project_id}/tasks", response_model=schemas.TaskListOut)
def list_tasks(project_id: int, request: Request, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    _require_task_read(db, project_id, current_user(request, db))
    p = _project(db, project_id)
    tasks = list(db.scalars(select(models.Task).where(models.Task.project_id == project_id)).all())
    steps_stages = [{"key": st["key"], "label": st["label"], "short": st.get("short", st["label"]), "index": i + 1} for i, st in enumerate(STAGE_CHECKLIST)]
    payload = _tasks_payload(db, p, tasks, actor)
    cur = payload[0]["project_current_stage_index"] if payload else 1
    steps = compute_steps(db, p, hide_money=not can_read_money(actor))
    return {"tasks": payload, "stages": steps_stages, "current_stage_index": cur,
            "template_missing": not tasks, "can_assign": allowed(actor, "assign_tasks"),
            "focus": focus_facts(p, steps, payload) if payload else []}


@router.get("/projects/{project_id}/tasks/{task_id}", response_model=schemas.TaskOut)
def get_task(project_id: int, task_id: int, request: Request, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    _require_task_read(db, project_id, current_user(request, db))
    p = _project(db, project_id)
    t = _task(db, project_id, task_id)
    return _tasks_payload(db, p, [t], actor)[0]


@router.get("/me/workbench", response_model=schemas.WorkbenchOut)
def my_workbench(db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    """工作台「项目关注」：每套房一行（位置、下一动作、行动者、截止），加待我确认 / 待分派 / 等待回复三个数。
    只看概况，不在这里做事；处理入口指向我的事项与项目总览。未购入的房也列（它们也要跟进）。"""
    # 使用真实账号的角色与有效成员关系；项目、指标、待审、交接共用同一可见范围。
    project_query = select(models.Project)
    if not allowed(me.role_code, "workbench_all_projects"):
        member_projects = select(models.ProjectMember.project_id).where(
            models.ProjectMember.user_id == me.id, models.ProjectMember.active.is_(True))
        project_query = project_query.where(models.Project.id.in_(member_projects))
    projects = db.scalars(project_query.order_by(models.Project.updated_at.desc())).all()
    visible_project_ids = [p.id for p in projects]
    hide = not can_read_money(me.role_code)
    rows_out: list[dict] = []
    pending_mine: list[dict] = []
    unassigned = waiting = 0
    for p in projects:
        steps = compute_steps(db, p, hide_money=hide)
        if steps["group_position"]["complete"]:
            continue
        tasks = list(db.scalars(select(models.Task).where(models.Task.project_id == p.id)).all())
        payload = _tasks_payload(db, p, tasks, me.role_code) if tasks else []
        cur_key = steps["current_stage"]["key"]
        nxt = next_action(payload, cur_key)
        cur_rows = [r for r in payload if r["stage_key"] == cur_key and r["exec_status"] != "done"]
        unassigned += sum(1 for r in cur_rows if not r["assignee"])
        waiting += sum(1 for r in payload if r["exec_status"] == "waiting")
        pending_mine.extend(r for r in payload if r["exec_status"] == "pending_review" and r["reviewer"] and r["reviewer"]["id"] == me.id)
        actor_brief = None
        if nxt:
            actor_brief = nxt["reviewer"] if nxt["exec_status"] == "pending_review" else nxt["assignee"]
        rows_out.append({
            "project_id": p.id, "project_name": p.name, "address": p.property.address_std,
            "group_position": steps["group_position"], "position_label": steps["group_position"]["label"],
            "next_action": ({"task_id": nxt["id"], "title": nxt["title"], "exec_status": nxt["exec_status"], "exec_status_label": nxt["exec_status_label"],
                             "due_at": nxt["due_at"], "actor": actor_brief, "kind": "review" if nxt["exec_status"] == "pending_review" else ("assign" if not nxt["assignee"] else "do")} if nxt else None),
            "waiting_count": sum(1 for r in payload if r["exec_status"] == "waiting"),
            "unassigned_current_count": sum(1 for r in cur_rows if not r["assignee"]),
        })
    pending_mine.sort(key=lambda r: (r["due_at"] or "9999", r["id"]))
    # 最近交接先按项目范围过滤，再取最近 6 条，避免其他项目的事件挤掉可见记录。
    evs = list(db.scalars(select(models.TaskEvent).where(
                          models.TaskEvent.project_id.in_(visible_project_ids),
                          models.TaskEvent.kind.in_(["submitted", "returned", "confirmed", "reassigned"]))
                          .order_by(models.TaskEvent.created_at.desc(), models.TaskEvent.id.desc()).limit(6)).all())
    ids = {e.actor_user_id for e in evs}
    for e in evs:
        for blob in (e.before_json, e.after_json):
            if blob:
                d = json.loads(blob)
                ids |= {d.get("assignee_user_id"), d.get("user_id")}
    users = _users_by_id(db, ids)
    names = {p.id: p.name for p in projects}
    titles = {t.id: t.title for t in db.scalars(select(models.Task).where(models.Task.id.in_([e.task_id for e in evs if e.task_id]))).all()} if evs else {}
    handoffs = [{**_event_out(e, users), "project_name": names.get(e.project_id), "task_title": titles.get(e.task_id)} for e in evs]
    return {"projects": rows_out, "my_pending": pending_mine,
            "counts": {"projects": len(rows_out), "pending_review_mine": len(pending_mine), "unassigned_current": unassigned, "waiting": waiting},
            "recent_handoffs": handoffs}


@router.get("/projects/{project_id}/members", response_model=schemas.MembersOut)
def list_members(project_id: int, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    _require_task_read(db, project_id, me)
    _project(db, project_id)
    members = _members(db, project_id)
    users = _users_by_id(db, {m.user_id for m in members})
    member_ids = set(users)
    rows = [{**_brief(users[m.user_id]), "role_snapshot": m.role_snapshot, "added_at": m.added_at} for m in members if m.user_id in users and users[m.user_id].active]
    others = [_brief(u) for u in db.scalars(select(models.User).where(models.User.active.is_(True)).order_by(models.User.role_code, models.User.id)).all() if u.id not in member_ids]
    can = allowed(me.role_code, "assign_tasks")
    return {"members": rows, "others": others, "can_assign": can, "can_add_member": can}


@router.get("/projects/{project_id}/tasks/{task_id}/events", response_model=list[schemas.TaskEventOut])
def task_events(project_id: int, task_id: int, request: Request, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    _require_task_read(db, project_id, current_user(request, db))
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
    query = select(models.Task).where((models.Task.assignee_user_id == me.id) | (models.Task.reviewer_user_id == me.id))
    if not allowed(me.role_code, "workbench_all_projects"):
        member_projects = select(models.ProjectMember.project_id).where(
            models.ProjectMember.user_id == me.id, models.ProjectMember.active.is_(True))
        query = query.where(models.Task.project_id.in_(member_projects))
    tasks = list(db.scalars(query).all())
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
    _commit_task(db, p, t, me.role_code)
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
    _commit_task(db, p, t, me.role_code)
    db.refresh(t)
    return _tasks_payload(db, p, [t], me.role_code)[0]


# ---------------- 交付：提交批次、退回、确认（KAN-75 块 5） ----------------

def _latest_submission(db: Session, task_id: int) -> Optional[models.TaskSubmission]:
    return db.scalar(select(models.TaskSubmission).where(models.TaskSubmission.task_id == task_id).order_by(models.TaskSubmission.seq.desc(), models.TaskSubmission.id.desc()))


@router.post("/projects/{project_id}/tasks/{task_id}/submit", response_model=schemas.TaskOut)
def submit_task(project_id: int, task_id: int, body: schemas.TaskSubmitIn, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    """负责人提交本次交付。文件 / 照片类交付物至少一个文件；联系、协调、确认类交说明即可。
    引用的文件必须属于本项目且当前账号能访问；上传本身还是走文件接口，这里不复制文件。"""
    p = _project(db, project_id)
    t = _task(db, project_id, task_id)
    if t.assignee_user_id != me.id:
        raise HTTPException(403, "只有这项任务的负责人能提交")
    if t.version != body.version:
        _conflict(db, p, t, me.role_code)
    if t.exec_status in ("pending_review", "done"):
        raise HTTPException(400, "已经提交过，等审核结果；不能重复提交")
    if t.reviewer_user_id is None:
        raise HTTPException(400, "这项任务还没有审核人，先让统筹指定")
    it = STEP_BY_KEY.get(t.step_key or "", {})
    requires_file = (it.get("deliverable") or {}).get("kind") in FILE_KINDS
    file_ids = list(dict.fromkeys(body.file_ids))
    if requires_file and not file_ids:
        raise HTTPException(400, f"这项任务要交「{(it.get('deliverable') or {}).get('label', '文件')}」，至少选一个文件再提交")
    if not (body.note or "").strip() and not file_ids:
        raise HTTPException(400, "提交说明不能为空")
    files: list[models.ProjectFile] = []
    for fid in file_ids:
        f = db.get(models.ProjectFile, fid)
        if f is None or f.project_id != project_id:
            raise HTTPException(400, f"文件 {fid} 不属于这个项目")
        if not _can_download(me.role_code, f):
            raise HTTPException(403, f"你没有权限使用文件「{f.filename}」")
        files.append(f)
    prev = _latest_submission(db, t.id)
    sub = models.TaskSubmission(task_id=t.id, project_id=project_id, seq=(prev.seq + 1 if prev else 1),
                                note=(body.note or "").strip() or None, submitted_by_user_id=me.id)
    db.add(sub)
    db.flush()
    for f in files:
        db.add(models.SubmissionFile(submission_id=sub.id, file_id=f.id))
    before = {"exec_status": t.exec_status}
    t.exec_status = "pending_review"
    t.wait_for = t.wait_reason = t.wait_until = None
    _event(db, t, project_id, "submitted", me, before=before, after={"exec_status": t.exec_status, "submission_id": sub.id, "seq": sub.seq, "files": len(files)})
    log_update(db, project_id, me.role_code, "task", f"提交了“{t.title}”第 {sub.seq} 次交付" + (f"（{len(files)} 个文件）" if files else ""))
    t.version += 1
    t.updated_at = now_iso()
    _commit_task(db, p, t, me.role_code)
    db.refresh(t)
    return _tasks_payload(db, p, [t], me.role_code)[0]


def _decide(db: Session, project_id: int, task_id: int, body: schemas.TaskDecisionIn, me: models.User, decision: str):
    p = _project(db, project_id)
    t = _task(db, project_id, task_id)
    if t.reviewer_user_id != me.id:
        owner = db.get(models.User, t.reviewer_user_id) if t.reviewer_user_id else None
        raise HTTPException(403, f"这项任务的审核人是 {owner.display_name if owner else '未指定'}，你不能{'退回' if decision == 'returned' else '确认'}")
    if t.version != body.version:
        _conflict(db, p, t, me.role_code)
    if t.exec_status != "pending_review":
        raise HTTPException(400, "现在没有待审核的提交")
    sub = _latest_submission(db, t.id)
    if sub is None or sub.decision != "pending":
        raise HTTPException(400, "找不到待审核的提交批次")
    if decision == "returned" and not (body.reason or "").strip():
        raise HTTPException(400, "退回要写修改要求，负责人才知道改什么")
    sub.decision = decision
    sub.decided_by_user_id = me.id
    sub.decided_at = now_iso()
    sub.decision_reason = (body.reason or "").strip() or None
    before = {"exec_status": t.exec_status}
    if decision == "confirmed":
        t.exec_status = "done"
        t.done_at = sub.decided_at
        kind = "confirmed"
        log_update(db, project_id, me.role_code, "task", f"确认了“{t.title}”第 {sub.seq} 次交付，任务完成")
    else:
        t.exec_status = "in_progress"
        kind = "returned"
        log_update(db, project_id, me.role_code, "task", f"退回了“{t.title}”第 {sub.seq} 次交付：{sub.decision_reason}")
    _event(db, t, project_id, kind, me, before=before, after={"exec_status": t.exec_status, "submission_id": sub.id, "seq": sub.seq}, reason=sub.decision_reason)
    t.version += 1
    t.updated_at = now_iso()
    _commit_task(db, p, t, me.role_code)
    db.refresh(t)
    return _tasks_payload(db, p, [t], me.role_code)[0]


@router.post("/projects/{project_id}/tasks/{task_id}/return", response_model=schemas.TaskOut)
def return_task(project_id: int, task_id: int, body: schemas.TaskDecisionIn, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    """审核人退回：原因必填；批次保留、意见可查；任务回到进行中。普通审核与 D/J、Final 无关。"""
    return _decide(db, project_id, task_id, body, me, "returned")


@router.post("/projects/{project_id}/tasks/{task_id}/confirm", response_model=schemas.TaskOut)
def confirm_task(project_id: int, task_id: int, body: schemas.TaskDecisionIn, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    """审核人确认本次交付：任务完成、记时间。**不补 ProjectStep 手工勾**——证据满足仍由 compute_steps 派生，两者并列显示。"""
    return _decide(db, project_id, task_id, body, me, "confirmed")
