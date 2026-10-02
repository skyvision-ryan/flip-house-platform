"""Count only explicit workflow transitions, never prose or general maintenance."""
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import event, select, update
from sqlalchemy.orm import Session

from . import models
from .project_dates import creation_instant

KINDS = frozenset({"started", "submitted", "waiting", "resumed", "returned", "confirmed",
                   "evidence_satisfied", "evidence_missing", "evidence_reviewed", "evidence_invalidated",
                   "node_confirmed", "procurement_completed", "procurement_reopened"})


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def initialize(db):
    if db.get(models.WorkflowBaseline, "state_changes") is None:
        db.add(models.WorkflowBaseline(key="state_changes", started_at=utc_now()))
        db.commit()


@event.listens_for(Session, "before_flush")
def count_structured_events(db, _context, _instances):
    # Only newly created structured events have a trustworthy timestamp/identity.
    # Legacy naive times and human-written history are deliberately not backfilled.
    for ev in list(db.new):
        if not isinstance(ev, models.TaskEvent) or ev.kind not in KINDS or ev.task_id is None:
            continue
        if json.loads(ev.after_json or "{}").get("mode") == "record":
            continue
        db.add(models.TaskWorkflowTransition(event=ev, project_id=ev.project_id, task_id=ev.task_id,
                                              kind=ev.kind, created_at=utc_now()))


def observe_procurement(db, project_id, actor):
    """Called after authorization, before the first procurement mutation in a transaction."""
    if project_id not in db.info.setdefault("procurement_before", {}):
        from .procurement_workflow import purchase_progress
        task = db.scalar(select(models.Task).where(models.Task.project_id == project_id, models.Task.step_key == "purchase"))
        if task:
            db.info["procurement_before"][project_id] = (task.id, purchase_progress(db, project_id)["complete"], actor)


@event.listens_for(Session, "before_commit")
def record_procurement_changes(db):
    observations = db.info.pop("procurement_before", {})
    if not observations:
        return
    db.flush()
    db.expire_all()  # bulk versioned order/material updates bypass the identity map
    from .procurement_workflow import purchase_progress
    if db.bind.dialect.name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert
    for pid, (tid, baseline, actor) in observations.items():
        met = purchase_progress(db, pid)["complete"]
        db.execute(insert(models.TaskEvidenceState).values(task_id=tid, met=baseline)
                   .on_conflict_do_nothing(index_elements=["task_id"]))
        changed = db.execute(update(models.TaskEvidenceState).where(models.TaskEvidenceState.task_id == tid,
                            models.TaskEvidenceState.met != met).values(met=met, observed_at=utc_now()))
        if changed.rowcount and baseline != met:
            db.add(models.TaskEvent(task_id=tid, project_id=pid,
                kind="procurement_completed" if met else "procurement_reopened",
                actor_user_id=actor.id if actor else None, actor_role_snapshot=actor.role_code if actor else None,
                before_json=json.dumps({"complete": not met}), after_json=json.dumps({"complete": met}), created_at=utc_now()))


@event.listens_for(Session, "after_rollback")
def discard_observations(db):
    db.info.pop("procurement_before", None)


def window(until=None):
    now = datetime.now(timezone.utc)
    end = creation_instant(until) if until else now
    if end is None or end > now + timedelta(seconds=5):
        from .message_codes import system_error
        raise system_error(400, "server.activityWindowInvalid")
    end = end.astimezone(timezone.utc)
    return {"from": (end - timedelta(days=7)).isoformat(timespec="microseconds"),
            "until": end.isoformat(timespec="microseconds")}


def visible_tasks(db, project_ids, actor):
    from .common_access import activity_allowed
    return [t.id for t in db.scalars(select(models.Task).where(models.Task.project_id.in_(project_ids)))
            if activity_allowed(t, actor)]


def query(db, project_ids, actor, bounds):
    return select(models.TaskWorkflowTransition).where(
        models.TaskWorkflowTransition.task_id.in_(visible_tasks(db, project_ids, actor)),
        models.TaskWorkflowTransition.project_id.in_(project_ids),
        models.TaskWorkflowTransition.created_at >= bounds["from"],
        models.TaskWorkflowTransition.created_at < bounds["until"])
